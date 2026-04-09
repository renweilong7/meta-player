import { PersistedAppSettings } from "@/lib/persistence/types";
import { StoryOutlineSearchResult, StoryOutlineSearchSegment } from "@/lib/story-outline/search";
import { safeRecordAiUsageEvent } from "@/lib/model-usage/service";
import { extractOpenAiTokenUsage } from "@/lib/model-usage/usage";

const SEARCH_CANDIDATE_LIMIT = 80;
const SEARCH_RESULT_LIMIT = 20;
const DEFAULT_SEARCH_MODEL = "gpt-4o-mini";

interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface LlmSearchResultDraft {
  segmentId?: unknown;
  score?: unknown;
}

const LLM_STORY_SEARCH_SYSTEM_PROMPT = `
你是一个视频剧情检索助手。

你的任务是：
1. 根据用户查询，从候选剧情片段中找出最匹配的片段。
2. 你只能从给定候选里选择，不能编造新的片段。
3. 返回严格 JSON 数组，不要返回 markdown，不要返回解释，不要返回代码块。
4. 每个数组元素必须包含：
   - "segmentId": 候选片段的唯一 ID
   - "score": 0 到 1 之间的小数，表示相关度，越高越相关
5. 结果必须按相关度降序排列。
6. 最多返回 10 条结果。
`;

const buildStorySearchUserPrompt = (
  query: string,
  candidates: StoryOutlineSearchSegment[]
) => `
用户查询：
${query}

候选剧情片段：
${JSON.stringify(
  candidates.map((candidate) => ({
    segmentId: candidate.id,
    assetTitle: candidate.assetTitle,
    sceneTitle: candidate.sceneTitle,
    sceneDescription: candidate.sceneDescription,
    shotAnalysis: candidate.shotAnalysisText || candidate.searchableText || undefined,
    timestamp: candidate.timestamp,
  })),
  null,
  2
)}

请只返回 JSON 数组。
`;

const getAssistantText = (payload: OpenAiChatCompletionResponse): string => {
  const firstChoice = payload.choices?.[0];
  const content = firstChoice?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const mergedText = content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();

    if (mergedText) {
      return mergedText;
    }
  }

  throw new Error("大模型搜索返回内容为空");
};

const tryParseJsonArray = (raw: string): LlmSearchResultDraft[] | null => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LlmSearchResultDraft[]) : null;
  } catch {
    return null;
  }
};

const parseSearchResultDrafts = (rawContent: string): LlmSearchResultDraft[] => {
  const normalizedContent = rawContent.trim();
  const directParse = tryParseJsonArray(normalizedContent);
  if (directParse) {
    return directParse;
  }

  const codeBlockMatch = normalizedContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    const parsedFromCodeBlock = tryParseJsonArray(codeBlockMatch[1].trim());
    if (parsedFromCodeBlock) {
      return parsedFromCodeBlock;
    }
  }

  const firstBracketIndex = normalizedContent.indexOf("[");
  const lastBracketIndex = normalizedContent.lastIndexOf("]");
  if (firstBracketIndex >= 0 && lastBracketIndex > firstBracketIndex) {
    const slicedJson = normalizedContent.slice(firstBracketIndex, lastBracketIndex + 1);
    const parsedFromSlice = tryParseJsonArray(slicedJson);
    if (parsedFromSlice) {
      return parsedFromSlice;
    }
  }

  throw new Error("大模型搜索返回内容不是合法的 JSON 数组");
};

const normalizeSearchResults = (
  drafts: LlmSearchResultDraft[],
  candidates: StoryOutlineSearchSegment[],
  limit: number
): StoryOutlineSearchResult[] => {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  return drafts
    .map((draft) => {
      if (typeof draft.segmentId !== "string") {
        return null;
      }

      const candidate = candidatesById.get(draft.segmentId);
      if (!candidate) {
        return null;
      }

      const score =
        typeof draft.score === "number" && Number.isFinite(draft.score)
          ? Math.max(0, Math.min(1, draft.score))
          : 0.5;

      return {
        ...candidate,
        score,
      };
    })
    .filter((result): result is StoryOutlineSearchResult => result !== null)
    .slice(0, limit);
};

const hasLlmSearchConfig = (settings: PersistedAppSettings) =>
  Boolean(
    settings.aiApiBaseUrl.trim() &&
      settings.aiApiKey.trim() &&
      (settings.aiSearchModelName.trim() || settings.aiModelName.trim())
  );

const buildMessages = (
  query: string,
  candidates: StoryOutlineSearchSegment[]
): OpenAiMessage[] => [
  {
    role: "system",
    content: LLM_STORY_SEARCH_SYSTEM_PROMPT.trim(),
  },
  {
    role: "user",
    content: buildStorySearchUserPrompt(query, candidates).trim(),
  },
];

export const canUseLlmStorySearch = (settings: PersistedAppSettings) =>
  hasLlmSearchConfig(settings);

export const rankStorySegmentsWithLlm = async (input: {
  query: string;
  candidates: StoryOutlineSearchSegment[];
  settings: PersistedAppSettings;
  limit?: number;
  projectId?: string;
}): Promise<StoryOutlineSearchResult[]> => {
  if (!hasLlmSearchConfig(input.settings)) {
    throw new Error("请先在设置页填写大模型搜索所需的 API 配置。");
  }

  const limit = Math.min(input.limit ?? SEARCH_RESULT_LIMIT, SEARCH_RESULT_LIMIT);
  const candidates = input.candidates.slice(0, SEARCH_CANDIDATE_LIMIT);

  if (candidates.length === 0) {
    return [];
  }

  const normalizedBaseUrl = input.settings.aiApiBaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.settings.aiApiKey}`,
    },
    body: JSON.stringify({
      model:
        input.settings.aiSearchModelName.trim() ||
        input.settings.aiModelName ||
        DEFAULT_SEARCH_MODEL,
      temperature: 0,
      messages: buildMessages(input.query, candidates),
    }),
  });

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  const tokenUsage = extractOpenAiTokenUsage(payload);
  const model =
    input.settings.aiSearchModelName.trim() ||
    input.settings.aiModelName ||
    DEFAULT_SEARCH_MODEL;

  if (!response.ok) {
    safeRecordAiUsageEvent({
      action: "story_outline_llm_search",
      provider: "openai_compatible",
      model,
      endpoint: `${normalizedBaseUrl}/chat/completions`,
      status: "error",
      errorMessage: payload.error?.message || "大模型搜索接口调用失败",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      inputCount: candidates.length,
      projectId: input.projectId,
      metadata: {
        queryLength: input.query.length,
      },
    });
    throw new Error(payload.error?.message || "大模型搜索接口调用失败");
  }

  try {
    const rawContent = getAssistantText(payload);
    const rawResults = parseSearchResultDrafts(rawContent);
    const results = normalizeSearchResults(rawResults, candidates, limit);

    safeRecordAiUsageEvent({
      action: "story_outline_llm_search",
      provider: "openai_compatible",
      model,
      endpoint: `${normalizedBaseUrl}/chat/completions`,
      status: "success",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      inputCount: candidates.length,
      projectId: input.projectId,
      metadata: {
        queryLength: input.query.length,
        resultCount: results.length,
      },
    });

    return results;
  } catch (error) {
    safeRecordAiUsageEvent({
      action: "story_outline_llm_search",
      provider: "openai_compatible",
      model,
      endpoint: `${normalizedBaseUrl}/chat/completions`,
      status: "error",
      errorMessage:
        error instanceof Error ? error.message : "大模型搜索结果解析失败",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      inputCount: candidates.length,
      projectId: input.projectId,
      metadata: {
        queryLength: input.query.length,
      },
    });
    throw error;
  }
};
