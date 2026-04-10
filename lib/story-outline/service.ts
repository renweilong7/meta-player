import {
  StoryOutlineGenerationConfig,
  StoryOutlineGenerationInput,
  StoryOutlineSceneRecord,
  StoryScene,
} from "@/lib/story-outline/types";
import {
  STORY_OUTLINE_SYSTEM_PROMPT,
  buildStoryOutlineUserPrompt,
} from "@/lib/story-outline/prompt";
import { storyOutlineResponseFormat } from "@/lib/ai/structured-output";
import { postAiUsageRecord } from "@/lib/persistence/client";
import { extractOpenAiTokenUsage } from "@/lib/model-usage/usage";

const DEFAULT_OUTLINE_MODEL = "gpt-4o-mini";

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

interface StoryOutlineSceneDraft {
  title?: unknown;
  description?: unknown;
  startTimecode?: unknown;
  endTimecode?: unknown;
  startSeconds?: unknown;
  endSeconds?: unknown;
}

interface StoryOutlineWrappedPayload {
  scenes?: unknown;
}

/**
 * 将 AI 提取结果映射为当前 UI 面板需要的展示模型。
 *
 * 注意这里不修改原始记录，只做只读映射，以便后续复用同一份记录进行存储或编辑。
 */
export const mapStoryOutlineToScenes = (
  records: StoryOutlineSceneRecord[]
): StoryScene[] =>
  records.map((record) => ({
    id: record.id,
    title: record.title,
    description: record.description,
    duration: formatDurationLabel(record.endSeconds - record.startSeconds),
    timestamp: `${record.startTimecode} - ${record.endTimecode}`,
    seekTime: record.startSeconds,
    shotAnalysis: record.shotAnalysis,
  }));

/**
 * 调用 OpenAI 兼容接口提取剧情大纲。
 *
 * 约束：
 * - 只负责“调用 AI + 解析 + 校验 + 规范化”。
 * - 不负责 UI 状态管理。
 * - 不负责存储。
 *
 * 这样可以让 service 层保持高内聚，并让页面层只处理交互状态。
 */
export const generateStoryOutline = async (
  input: StoryOutlineGenerationInput,
  config: StoryOutlineGenerationConfig
): Promise<StoryOutlineSceneRecord[]> => {
  const normalizedBaseUrl = config.baseUrl.replace(/\/+$/, "");
  const model = config.model ?? DEFAULT_OUTLINE_MODEL;
  const response = await fetch(`${normalizedBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: storyOutlineResponseFormat,
      messages: buildMessages(input),
    }),
  });

  const payload = (await response.json()) as OpenAiChatCompletionResponse;
  const tokenUsage = extractOpenAiTokenUsage(payload);

  if (!response.ok) {
    await recordUsage({
      action: "story_outline_generation",
      provider: "openai_compatible",
      model,
      endpoint: `${normalizedBaseUrl}/chat/completions`,
      status: "error",
      errorMessage: payload.error?.message || "AI 接口调用失败",
      ...tokenUsage,
      inputCount: 1,
      materialId: config.materialId,
      metadata: {
        mediaTitle: input.mediaTitle,
      },
    });
    throw new Error(payload.error?.message || "AI 接口调用失败");
  }

  try {
    const rawContent = getAssistantText(payload);
    const rawScenes = parseSceneDrafts(rawContent);
    const srtTimelineBounds = extractSrtTimelineBounds(input.srtContent);

    const normalizedScenes = normalizeSceneDrafts(rawScenes, srtTimelineBounds);
    await recordUsage({
      action: "story_outline_generation",
      provider: "openai_compatible",
      model,
      endpoint: `${normalizedBaseUrl}/chat/completions`,
      status: "success",
      ...tokenUsage,
      inputCount: 1,
      materialId: config.materialId,
      metadata: {
        mediaTitle: input.mediaTitle,
        sceneCount: normalizedScenes.length,
      },
    });

    return normalizedScenes;
  } catch (error) {
    await recordUsage({
      action: "story_outline_generation",
      provider: "openai_compatible",
      model,
      endpoint: `${normalizedBaseUrl}/chat/completions`,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "剧情大纲提取失败",
      ...tokenUsage,
      inputCount: 1,
      materialId: config.materialId,
      metadata: {
        mediaTitle: input.mediaTitle,
      },
    });
    throw error;
  }
};

const recordUsage = async (input: Parameters<typeof postAiUsageRecord>[0]) => {
  try {
    await postAiUsageRecord(input);
  } catch (error) {
    console.error("Failed to persist story outline usage", error);
  }
};

const buildMessages = (
  input: StoryOutlineGenerationInput
): OpenAiMessage[] => [
  {
    role: "system",
    content: STORY_OUTLINE_SYSTEM_PROMPT.trim(),
  },
  {
    role: "user",
    content: buildStoryOutlineUserPrompt(input).trim(),
  },
];

/**
 * OpenAI 兼容接口的 `message.content` 可能是字符串，也可能是结构化数组。
 *
 * 为了兼容不同供应商的实现，这里统一把文本拼接出来。
 */
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

  throw new Error("AI 返回内容为空，无法生成剧情大纲");
};

/**
 * 从 AI 文本中提取剧情场景数组。
 *
 * 虽然提示词要求只返回 JSON，但实际兼容接口时仍然要兜底，
 * 否则模型一旦包裹 ```json 代码块就会直接导致流程失败。
 */
const parseSceneDrafts = (rawContent: string): StoryOutlineSceneDraft[] => {
  const normalizedContent = rawContent.trim();
  const directParse = tryParseJsonArray(normalizedContent);
  if (directParse) {
    return directParse;
  }

  const wrappedDirectParse = tryParseWrappedScenes(normalizedContent);
  if (wrappedDirectParse) {
    return wrappedDirectParse;
  }

  const codeBlockMatch = normalizedContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch?.[1]) {
    const codeBlockContent = codeBlockMatch[1].trim();
    const parsedFromCodeBlock = tryParseJsonArray(codeBlockContent);
    if (parsedFromCodeBlock) {
      return parsedFromCodeBlock;
    }

    const parsedWrappedCodeBlock = tryParseWrappedScenes(codeBlockContent);
    if (parsedWrappedCodeBlock) {
      return parsedWrappedCodeBlock;
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

  const firstBraceIndex = normalizedContent.indexOf("{");
  const lastBraceIndex = normalizedContent.lastIndexOf("}");
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    const slicedJson = normalizedContent.slice(firstBraceIndex, lastBraceIndex + 1);
    const parsedWrappedSlice = tryParseWrappedScenes(slicedJson);
    if (parsedWrappedSlice) {
      return parsedWrappedSlice;
    }
  }

  throw new Error("AI 返回内容不是合法的 JSON 数组");
};

const tryParseJsonArray = (raw: string): StoryOutlineSceneDraft[] | null => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoryOutlineSceneDraft[]) : null;
  } catch {
    return null;
  }
};

const tryParseWrappedScenes = (raw: string): StoryOutlineSceneDraft[] | null => {
  try {
    const parsed = JSON.parse(raw) as StoryOutlineWrappedPayload;
    return Array.isArray(parsed.scenes) ? (parsed.scenes as StoryOutlineSceneDraft[]) : null;
  } catch {
    return null;
  }
};

/**
 * 对 AI 草稿数据做强校验和规范化。
 *
 * 这里故意不“宽松接收”，因为：
 * - 过度宽松会把脏数据带入后续存储层；
 * - 一旦数据格式不稳定，后面的编辑、排序、持久化都会更难维护。
 */
const normalizeSceneDrafts = (
  drafts: StoryOutlineSceneDraft[],
  srtTimelineBounds: TimelineBounds | null
): StoryOutlineSceneRecord[] => {
  if (drafts.length === 0) {
    throw new Error("AI 未返回任何场景数据");
  }

  const normalizedDrafts = drafts
    .map((draft, index) => {
    const title = requireNonEmptyString(draft.title, `第 ${index + 1} 个场景缺少 title`);
    const description = requireNonEmptyString(
      draft.description,
      `第 ${index + 1} 个场景缺少 description`
    );
    const startTimecode = normalizeTimecode(
      draft.startTimecode,
      `第 ${index + 1} 个场景的 startTimecode 无效`
    );
    const endTimecode = normalizeTimecode(
      draft.endTimecode,
      `第 ${index + 1} 个场景的 endTimecode 无效`
    );
    const startSeconds = requireInteger(
      draft.startSeconds,
      `第 ${index + 1} 个场景的 startSeconds 无效`
    );
    const endSeconds = requireInteger(
      draft.endSeconds,
      `第 ${index + 1} 个场景的 endSeconds 无效`
    );

    if (endSeconds <= startSeconds) {
      throw new Error(`第 ${index + 1} 个场景的时间范围无效`);
    }

    return {
      id: createSceneId(index, title, startSeconds),
      title,
      description,
      startSeconds,
      endSeconds,
      startTimecode,
      endTimecode,
    };
    })
    .sort((left, right) => left.startSeconds - right.startSeconds);

  return enforceContinuousTimeline(normalizedDrafts, srtTimelineBounds);
};

const requireNonEmptyString = (value: unknown, errorMessage: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(errorMessage);
  }

  return value.trim();
};

const requireInteger = (value: unknown, errorMessage: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(errorMessage);
  }

  return value;
};

/**
 * 统一校验时间码格式为 HH:MM:SS，避免出现 1:2:3 这类不稳定格式。
 */
const normalizeTimecode = (value: unknown, errorMessage: string): string => {
  if (typeof value !== "string") {
    throw new Error(errorMessage);
  }

  const trimmedValue = value.trim();
  if (!/^\d{2}:\d{2}:\d{2}$/.test(trimmedValue)) {
    throw new Error(errorMessage);
  }

  return trimmedValue;
};

interface TimelineBounds {
  startSeconds: number;
  endSeconds: number;
}

/**
 * 从 SRT 中提取整条素材的起止时间。
 *
 * 这里把 SRT 视为时间轴真值来源：
 * - 第一个字幕的起始时间，视为剧情大纲的开始；
 * - 最后一个字幕的结束时间，视为剧情大纲的结束。
 *
 * 后续即使 AI 对切分边界判断有偏差，也会由本地规范化逻辑修正成完整连续覆盖。
 */
const extractSrtTimelineBounds = (srtContent: string): TimelineBounds | null => {
  const timelinePattern =
    /(\d{2}:\d{2}:\d{2})[,.](\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2})[,.](\d{3})/g;
  const matches = Array.from(srtContent.matchAll(timelinePattern));

  if (matches.length === 0) {
    return null;
  }

  const firstMatch = matches[0];
  const lastMatch = matches[matches.length - 1];
  const startSeconds = parseSrtTimestamp(firstMatch[1], firstMatch[2], "floor");
  const endSeconds = parseSrtTimestamp(lastMatch[3], lastMatch[4], "ceil");

  if (endSeconds <= startSeconds) {
    return null;
  }

  return {
    startSeconds,
    endSeconds,
  };
};

/**
 * 把 AI 给出的切分结果压实成一条连续时间线。
 *
 * 原则：
 * - 优先保留 AI 给出的“切分意图”，也就是每个场景原始 startSeconds。
 * - 但最终边界必须服从 SRT 的总起止时间。
 * - 场景之间不能留空，也不能重叠。
 *
 * 实现方式：
 * - 使用场景原始 startSeconds 作为候选切分点；
 * - 再按时间顺序逐个夹紧到合法范围；
 * - 最终用相邻边界直接构造 start/end，保证全程连续。
 */
const enforceContinuousTimeline = (
  scenes: StoryOutlineSceneRecord[],
  srtTimelineBounds: TimelineBounds | null
): StoryOutlineSceneRecord[] => {
  if (scenes.length === 0) {
    return scenes;
  }

  const fallbackBounds = {
    startSeconds: scenes[0].startSeconds,
    endSeconds: scenes[scenes.length - 1].endSeconds,
  };
  const timelineBounds = srtTimelineBounds ?? fallbackBounds;

  if (scenes.length === 1) {
    return [
      {
        ...scenes[0],
        id: createSceneId(0, scenes[0].title, timelineBounds.startSeconds),
        startSeconds: timelineBounds.startSeconds,
        endSeconds: timelineBounds.endSeconds,
        startTimecode: formatSecondsToTimecode(timelineBounds.startSeconds),
        endTimecode: formatSecondsToTimecode(timelineBounds.endSeconds),
      },
    ];
  }

  const boundaries: number[] = [timelineBounds.startSeconds];

  for (let index = 1; index < scenes.length; index += 1) {
    const candidateBoundary = scenes[index].startSeconds;
    const minimumBoundary = boundaries[index - 1] + 1;
    const remainingScenes = scenes.length - index;
    const maximumBoundary = timelineBounds.endSeconds - remainingScenes;

    boundaries.push(clamp(candidateBoundary, minimumBoundary, maximumBoundary));
  }

  boundaries.push(timelineBounds.endSeconds);

  return scenes.map((scene, index) => {
    const startSeconds = boundaries[index];
    const endSeconds = boundaries[index + 1];

    return {
      ...scene,
      id: createSceneId(index, scene.title, startSeconds),
      startSeconds,
      endSeconds,
      startTimecode: formatSecondsToTimecode(startSeconds),
      endTimecode: formatSecondsToTimecode(endSeconds),
    };
  });
};

const parseSrtTimestamp = (
  timecode: string,
  milliseconds: string,
  rounding: "floor" | "ceil"
): number => {
  const [hours, minutes, seconds] = timecode.split(":").map(Number);
  const totalMilliseconds =
    ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(milliseconds);

  if (rounding === "ceil") {
    return Math.ceil(totalMilliseconds / 1000);
  }

  return Math.floor(totalMilliseconds / 1000);
};

const formatSecondsToTimecode = (totalSeconds: number): string => {
  const safeSeconds = Math.max(totalSeconds, 0);
  const hours = Math.floor(safeSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((safeSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(safeSeconds % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
};

const clamp = (value: number, minimum: number, maximum: number): number => {
  if (minimum > maximum) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
};

/**
 * 生成稳定且适合存储的场景 ID。
 *
 * 这里不依赖随机数，避免同一份 AI 结果在重复解析时产生完全不同的 ID，
 * 这会让后续编辑 diff、缓存和持久化都更麻烦。
 */
const createSceneId = (index: number, title: string, startSeconds: number): string => {
  const normalizedTitle = title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
    .slice(0, 24);

  return `scene-${index + 1}-${startSeconds}-${normalizedTitle || "untitled"}`;
};

const formatDurationLabel = (durationSeconds: number): string => {
  const safeDuration = Math.max(durationSeconds, 0);
  const hours = Math.floor(safeDuration / 3600);
  const minutes = Math.floor((safeDuration % 3600) / 60);
  const seconds = safeDuration % 60;

  if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  }

  if (minutes > 0) {
    return `${minutes}分钟${seconds > 0 ? `${seconds}秒` : ""}`;
  }

  return `${seconds}秒`;
};
