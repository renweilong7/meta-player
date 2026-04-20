import { PersistedAppSettings } from "@/lib/persistence/types";
import { storySearchResponseFormat } from "@/lib/ai/structured-output";
import {
  getProviderDisplayName,
  resolveSearchModelProviderConfig,
} from "@/lib/ai/provider-config";
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

interface LlmSearchWrappedPayload {
  results?: unknown;
  items?: unknown;
  data?: unknown;
  matches?: unknown;
}

const LLM_STORY_SEARCH_SYSTEM_PROMPT = `
你是一个视频剧情检索助手。

你的任务是：
1. 根据用户查询，从候选剧情片段中找出最匹配的片段。
2. 你只能从给定候选里选择，不能编造新的片段。
3. 返回严格 JSON 对象，不要返回 markdown，不要返回解释，不要返回代码块。
4. JSON 对象必须包含 "results" 字段，且它是数组。
5. 每个数组元素必须包含：
   - "segmentId": 候选片段的唯一 ID
   - "score": 0 到 1 之间的小数，表示相关度，越高越相关
6. results 结果必须按相关度降序排列。
7. 最多返回 10 条结果。
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

请只返回形如 {"results":[...]} 的 JSON 对象。
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

const tryParseWrappedJsonArray = (raw: string): LlmSearchResultDraft[] | null => {
  try {
    const parsed = JSON.parse(raw) as LlmSearchWrappedPayload;
    const arrayCandidate = [parsed.results, parsed.items, parsed.data, parsed.matches].find(
      (value) => Array.isArray(value)
    );

    return Array.isArray(arrayCandidate) ? (arrayCandidate as LlmSearchResultDraft[]) : null;
  } catch {
    return null;
  }
};

const getBalancedJsonSlice = (
  rawContent: string,
  openingBracket: "[" | "{",
  closingBracket: "]" | "}"
) => {
  const startIndex = rawContent.indexOf(openingBracket);
  if (startIndex < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < rawContent.length; index += 1) {
    const character = rawContent[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === "\\") {
        escaped = true;
        continue;
      }

      if (character === "\"") {
        inString = false;
      }

      continue;
    }

    if (character === "\"") {
      inString = true;
      continue;
    }

    if (character === openingBracket) {
      depth += 1;
      continue;
    }

    if (character === closingBracket) {
      depth -= 1;

      if (depth === 0) {
        return rawContent.slice(startIndex, index + 1);
      }
    }
  }

  return null;
};

const parseSearchResultDrafts = (rawContent: string): LlmSearchResultDraft[] => {
  const normalizedContent = rawContent.trim().replace(/^json\s*/i, "");
  const directParse = tryParseJsonArray(normalizedContent);
  if (directParse) {
    return directParse;
  }

  const wrappedDirectParse = tryParseWrappedJsonArray(normalizedContent);
  if (wrappedDirectParse) {
    return wrappedDirectParse;
  }

  const codeBlockMatch = normalizedContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    const codeBlockContent = codeBlockMatch[1].trim().replace(/^json\s*/i, "");
    const parsedFromCodeBlock = tryParseJsonArray(codeBlockContent);
    if (parsedFromCodeBlock) {
      return parsedFromCodeBlock;
    }

    const parsedWrappedCodeBlock = tryParseWrappedJsonArray(codeBlockContent);
    if (parsedWrappedCodeBlock) {
      return parsedWrappedCodeBlock;
    }
  }

  const slicedJsonArray = getBalancedJsonSlice(normalizedContent, "[", "]");
  if (slicedJsonArray) {
    const parsedFromSlice = tryParseJsonArray(slicedJsonArray);
    if (parsedFromSlice) {
      return parsedFromSlice;
    }
  }

  const slicedJsonObject = getBalancedJsonSlice(normalizedContent, "{", "}");
  if (slicedJsonObject) {
    const parsedWrappedSlice = tryParseWrappedJsonArray(slicedJsonObject);
    if (parsedWrappedSlice) {
      return parsedWrappedSlice;
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

const hasLlmSearchConfig = (settings: PersistedAppSettings) => {
  const providerConfig = resolveSearchModelProviderConfig(settings);

  return Boolean(
    providerConfig.baseUrl &&
      providerConfig.apiKey &&
      providerConfig.model
  );
};

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

  const providerConfig = resolveSearchModelProviderConfig(input.settings);
  const requestBody: Record<string, unknown> = {
    model: providerConfig.model || DEFAULT_SEARCH_MODEL,
    temperature: 0,
    stream: false,
    messages: buildMessages(input.query, candidates),
  };

  if (providerConfig.provider === "openai_compatible") {
    requestBody.response_format = storySearchResponseFormat;
  }

  const response = await fetch(`${providerConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${providerConfig.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  const tokenUsage = extractOpenAiTokenUsage(payload);
  const model = providerConfig.model || DEFAULT_SEARCH_MODEL;
  const provider = providerConfig.provider;
  const providerName = getProviderDisplayName(provider);

  if (!response.ok) {
    safeRecordAiUsageEvent({
      action: "story_outline_llm_search",
      provider,
      model,
      endpoint: `${providerConfig.baseUrl}/chat/completions`,
      status: "error",
      errorMessage: payload.error?.message || `${providerName} 大模型搜索接口调用失败`,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      inputCount: candidates.length,
      projectId: input.projectId,
      metadata: {
        queryLength: input.query.length,
      },
    });
    throw new Error(payload.error?.message || `${providerName} 大模型搜索接口调用失败`);
  }

  try {
    const rawContent = getAssistantText(payload);
    const rawResults = parseSearchResultDrafts(rawContent);
    const results = normalizeSearchResults(rawResults, candidates, limit);

    safeRecordAiUsageEvent({
      action: "story_outline_llm_search",
      provider,
      model,
      endpoint: `${providerConfig.baseUrl}/chat/completions`,
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
      provider,
      model,
      endpoint: `${providerConfig.baseUrl}/chat/completions`,
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
