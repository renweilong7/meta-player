import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistedAppSettings, PersistedMaterial } from "@/lib/persistence/types";
import { sceneShotAnalysisResponseFormat } from "@/lib/ai/structured-output";
import { extractSubtitleBlocksInRange } from "@/lib/project-script/srt";
import {
  resolveFfmpegExecutable,
  resolveBundledPythonExecutable,
  resolveBundledPythonScriptPath,
} from "@/lib/runtime/resource-paths";
import {
  SceneShotAnalysis,
  SceneShotAnalysisSegment,
  StoryOutlineSceneRecord,
} from "@/lib/story-outline/types";
import { safeRecordAiUsageEvent } from "@/lib/model-usage/service";
import { extractOpenAiTokenUsage } from "@/lib/model-usage/usage";
import { createServerLogger, formatErrorForLog } from "@/lib/observability/logger";

interface ShotAnalysisDraft {
  summary?: unknown;
  action?: unknown;
  expressionAndGaze?: unknown;
  cinematography?: unknown;
  atmosphere?: unknown;
  commentaryHooks?: unknown;
  overview?: unknown;
  actions?: unknown;
  expression?: unknown;
  gaze?: unknown;
  camera?: unknown;
  mood?: unknown;
  hooks?: unknown;
  shotAnalysis?: unknown;
  analysis?: unknown;
  result?: unknown;
  data?: unknown;
  segments?: unknown;
}

interface ShotAnalysisSegmentDraft {
  startOffsetSeconds?: unknown;
  endOffsetSeconds?: unknown;
  startSeconds?: unknown;
  endSeconds?: unknown;
  start?: unknown;
  end?: unknown;
  summary?: unknown;
  action?: unknown;
  expressionAndGaze?: unknown;
  cinematography?: unknown;
  atmosphere?: unknown;
  commentaryHooks?: unknown;
  overview?: unknown;
  actions?: unknown;
  expression?: unknown;
  gaze?: unknown;
  camera?: unknown;
  mood?: unknown;
  hooks?: unknown;
}

interface PythonShotAnalysisPayload {
  content?: string;
  text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface GeminiFileUploadResponse {
  file?: {
    name?: string;
    uri?: string;
    state?: string;
    mimeType?: string;
  };
  error?: {
    message?: string;
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    message?: string;
  };
}

const DEFAULT_VISION_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";
const DEFAULT_VISION_MODEL = "qwen3.6-plus";
const DEFAULT_GEMINI_VISION_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_VISION_MODEL = "gemini-2.5-flash";
const DEFAULT_GROK2API_BASE_URL =
  process.env.META_PLAYER_GROK2API_BASE_URL?.trim() || "http://127.0.0.1:8000/v1";
const DEFAULT_GROK2API_VISION_MODEL = "grok-2-vision-latest";
const DEFAULT_VISION_FPS = 2;
const MIN_VISION_FPS = 0.1;
const MAX_VISION_FPS = 10;
const RAW_RESPONSE_LOG_EXCERPT_LENGTH = 800;
const GEMINI_FILE_POLL_INTERVAL_MS = 2000;
const GEMINI_FILE_MIN_POLL_TIMEOUT_MS = 120000;
const GEMINI_FILE_MAX_POLL_TIMEOUT_MS = 15 * 60 * 1000;
const GROK2API_FRAME_MIN_COUNT = 4;
const GROK2API_FRAME_MAX_COUNT = 24;

interface OpenAiCompatibleChatCompletionResponse {
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
    input_tokens?: number;
    output_tokens?: number;
  };
}

const shotAnalysisLogger = createServerLogger("server", {
  component: "shot-analysis",
});

const SHOT_ANALYSIS_SYSTEM_PROMPT = `
你是一个影视场景镜头解读助手。

你的任务是基于用户提供的场景基础信息和视频片段，输出偏元数据、可复用、可检索的结构化结果。

要求：
1. 只返回一个 JSON 对象，不要输出 markdown，不要输出解释文字，不要输出代码块。
2. JSON 顶层只保留一个字段："segments"。
3. "segments" 需要返回 1 到 8 个连续时间切片；每个切片必须包含：
   - "startOffsetSeconds": 相对当前 scene 开始时间的秒数，>= 0。
   - "endOffsetSeconds": 相对当前 scene 开始时间的秒数，且必须大于 startOffsetSeconds。
   - "summary": 1 到 2 句概括该切片最值得记录的可见信息。
   - "action": 只描述人物动作、互动和动作变化，不推断动机。
   - "expressionAndGaze": 只描述表情、眼神、视线方向和情绪张力，不解释内心。
   - "cinematography": 描述景别、机位、运镜、构图焦点和前后景关系。
   - "atmosphere": 描述光线、色调、环境状态和整体画面气质。
   - "commentaryHooks": 提炼适合影视解说复用的信息点，强调可见证据，不写象征意义。
4. 不要在顶层重复输出整段 scene 级别的 summary、action、expressionAndGaze、cinematography、atmosphere、commentaryHooks。
5. 严禁输出导演意图、象征意义、隐喻、主题升华等主观阐释。
6. 若视频信息有限，也要基于可观察内容给出谨慎描述，避免编造。
7. 语言简洁、稳定，适合后续作为结构化元数据使用。
8. 你会同时拿到视频片段和一份外部字幕文本，但外部字幕可能包含识别错误、串行、时间错位或污染内容。
9. 你必须优先相信视频中直接可见的信息，包括人物动作、口型对应的画面线索，以及画面里能识别出的字幕、对白文字、屏幕文字。
10. 如果视频里能识别出字幕或屏幕文字，应以视频中识别到的文字为最高优先级；外部字幕只能作为低置信度参考。
11. 如果外部字幕与视频中能识别出的字幕、画面文字或动作线索冲突，忽略外部字幕，不要被其带偏。
12. 如果视频中看不清字幕或根本没有字幕，才可以谨慎参考外部字幕，但不能把外部字幕里缺乏视觉依据的细节当成事实。
13. 切片必须按时间顺序输出，不能重叠，尽量覆盖当前 scene 的主要内容；如果内容单一，可以只返回 1 个切片。
`.trim();

const clampVisionFps = (rawValue: string | undefined) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_VISION_FPS;
  }

  return Math.min(MAX_VISION_FPS, Math.max(MIN_VISION_FPS, parsed));
};

const truncateForLog = (value: string, maxLength = RAW_RESPONSE_LOG_EXCERPT_LENGTH) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}…[truncated]` : value;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getGeminiFilePollTimeoutMs = (scene: StoryOutlineSceneRecord) => {
  const sceneDurationMs = getSceneDurationSeconds(scene) * 1500;
  return Math.min(
    GEMINI_FILE_MAX_POLL_TIMEOUT_MS,
    Math.max(GEMINI_FILE_MIN_POLL_TIMEOUT_MS, sceneDurationMs)
  );
};

const buildShotAnalysisLogContext = (input: {
  material: PersistedMaterial;
  scene: StoryOutlineSceneRecord;
  model?: string;
  baseUrl?: string;
  fps?: number;
  videoPath?: string;
}) => ({
  materialId: input.material.id,
  materialTitle: input.material.title,
  sceneId: input.scene.id,
  sceneTitle: input.scene.title,
  sceneStartSeconds: input.scene.startSeconds,
  sceneEndSeconds: input.scene.endSeconds,
  model: input.model,
  endpoint: input.baseUrl,
  fps: input.fps,
  videoPath: input.videoPath,
});

const summarizeResponseDraft = (rawContent: string) => {
  const trimmed = rawContent.trim();

  try {
    const parsed = parseShotAnalysisDraft(trimmed);
    const unwrapped = unwrapShotAnalysisDraft(parsed);

    return {
      contentLength: trimmed.length,
      excerpt: truncateForLog(trimmed),
      topLevelKeys: isRecord(parsed) ? Object.keys(parsed).slice(0, 20) : [],
      normalizedKeys: Object.keys(unwrapped).slice(0, 20),
    };
  } catch {
    return {
      contentLength: trimmed.length,
      excerpt: truncateForLog(trimmed),
      topLevelKeys: [] as string[],
      normalizedKeys: [] as string[],
    };
  }
};

const extractJsonObjectString = (rawContent: string) => {
  const normalizedContent = rawContent.trim();

  if (!normalizedContent) {
    throw new Error("AI 返回内容为空。");
  }

  const candidates = [
    normalizedContent,
    normalizedContent.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      const firstBraceIndex = candidate.indexOf("{");
      const lastBraceIndex = candidate.lastIndexOf("}");

      if (firstBraceIndex === -1 || lastBraceIndex === -1 || lastBraceIndex <= firstBraceIndex) {
        continue;
      }

      const slicedCandidate = candidate.slice(firstBraceIndex, lastBraceIndex + 1);

      try {
        JSON.parse(slicedCandidate);
        return slicedCandidate;
      } catch {
        continue;
      }
    }
  }

  throw new Error("AI 返回内容不是合法的 JSON 对象。");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pickFirstNonEmptyString = (
  source: Record<string, unknown>,
  keys: string[]
) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
};

const unwrapShotAnalysisDraft = (draft: ShotAnalysisDraft): Record<string, unknown> => {
  const queue: unknown[] = [draft];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!isRecord(current)) {
      continue;
    }

    if (Array.isArray(current.segments) && current.segments.length > 0) {
      return current;
    }

    queue.push(current.shotAnalysis, current.analysis, current.result, current.data);
  }

  return isRecord(draft) ? draft : {};
};

const parseShotAnalysisDraft = (rawContent: string) => {
  const jsonContent = extractJsonObjectString(rawContent);
  return JSON.parse(jsonContent) as ShotAnalysisDraft;
};

const formatSecondsToTimecode = (totalSeconds: number) => {
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

const clampNumber = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

const requireNonNegativeNumber = (value: unknown, errorMessage: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(errorMessage);
  }

  return value;
};

const buildSegmentTextFields = (source: Record<string, unknown>) => ({
  summary: requireNonEmptyString(
    pickFirstNonEmptyString(source, [
      "summary",
      "overview",
      "概括",
      "总结",
      "摘要",
      "镜头概述",
      "场景概述",
    ]),
    "镜头解读切片缺少 summary。"
  ),
  action: requireNonEmptyString(
    pickFirstNonEmptyString(source, [
      "action",
      "actions",
      "人物动作",
      "动作",
      "行为",
    ]),
    "镜头解读切片缺少 action。"
  ),
  expressionAndGaze: requireNonEmptyString(
    pickFirstNonEmptyString(source, [
      "expressionAndGaze",
      "expression",
      "gaze",
      "表情与眼神",
      "表情",
      "眼神",
      "视线",
    ]),
    "镜头解读切片缺少 expressionAndGaze。"
  ),
  cinematography: requireNonEmptyString(
    pickFirstNonEmptyString(source, [
      "cinematography",
      "camera",
      "镜头语言",
      "镜头",
      "运镜",
      "构图",
    ]),
    "镜头解读切片缺少 cinematography。"
  ),
  atmosphere: requireNonEmptyString(
    pickFirstNonEmptyString(source, [
      "atmosphere",
      "mood",
      "氛围",
      "画面氛围",
      "环境氛围",
    ]),
    "镜头解读切片缺少 atmosphere。"
  ),
  commentaryHooks: requireNonEmptyString(
    pickFirstNonEmptyString(source, [
      "commentaryHooks",
      "hooks",
      "解说价值点",
      "解说钩子",
      "可解说点",
    ]),
    "镜头解读切片缺少 commentaryHooks。"
  ),
});

const normalizeShotAnalysisSegments = (
  source: Record<string, unknown>,
  scene: StoryOutlineSceneRecord
): SceneShotAnalysisSegment[] => {
  const rawSegments = Array.isArray(source.segments) ? source.segments : [];
  const sceneDurationSeconds = getSceneDurationSeconds(scene);

  if (rawSegments.length === 0) {
    throw new Error("镜头解读缺少 segments。");
  }

  const normalizedSegments = rawSegments
    .map((segment, index) => {
      if (!isRecord(segment)) {
        throw new Error(`第 ${index + 1} 个镜头解读切片不是对象。`);
      }

      const rawStartOffset = requireNonNegativeNumber(
        segment.startOffsetSeconds ?? segment.startSeconds ?? segment.start,
        `第 ${index + 1} 个镜头解读切片缺少 startOffsetSeconds。`
      );
      const rawEndOffset = requireNonNegativeNumber(
        segment.endOffsetSeconds ?? segment.endSeconds ?? segment.end,
        `第 ${index + 1} 个镜头解读切片缺少 endOffsetSeconds。`
      );

      if (rawEndOffset <= rawStartOffset) {
        throw new Error(`第 ${index + 1} 个镜头解读切片时间范围无效。`);
      }

      const startOffsetSeconds = clampNumber(rawStartOffset, 0, sceneDurationSeconds);
      const endOffsetSeconds = clampNumber(rawEndOffset, 0, sceneDurationSeconds);

      if (endOffsetSeconds <= startOffsetSeconds) {
        throw new Error(`第 ${index + 1} 个镜头解读切片超出当前场景时间范围。`);
      }

      const startSeconds = scene.startSeconds + startOffsetSeconds;
      const endSeconds = scene.startSeconds + endOffsetSeconds;
      const textFields = buildSegmentTextFields(segment);

      return {
        id: `${scene.id}-segment-${index + 1}`,
        startSeconds,
        endSeconds,
        startTimecode: formatSecondsToTimecode(startSeconds),
        endTimecode: formatSecondsToTimecode(endSeconds),
        ...textFields,
      };
    })
    .sort((left, right) => left.startSeconds - right.startSeconds);

  return normalizedSegments.map((segment, index) => {
    const previousSegment = normalizedSegments[index - 1];
    const nextSegment = normalizedSegments[index + 1];
    const minimumStart = previousSegment ? previousSegment.endSeconds : scene.startSeconds;
    const maximumEnd = nextSegment ? nextSegment.startSeconds : scene.endSeconds;
    const startSeconds = clampNumber(segment.startSeconds, minimumStart, maximumEnd);
    const endSeconds = clampNumber(segment.endSeconds, startSeconds, maximumEnd);

    if (endSeconds <= startSeconds) {
      throw new Error(`第 ${index + 1} 个镜头解读切片与相邻切片发生重叠。`);
    }

    return {
      ...segment,
      startSeconds,
      endSeconds,
      startTimecode: formatSecondsToTimecode(startSeconds),
      endTimecode: formatSecondsToTimecode(endSeconds),
    };
  });
};

const requireNonEmptyString = (value: unknown, errorMessage: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(errorMessage);
  }

  return value.trim();
};

const normalizeShotAnalysis = (
  draft: ShotAnalysisDraft,
  scene: StoryOutlineSceneRecord
): SceneShotAnalysis => {
  const normalizedDraft = unwrapShotAnalysisDraft(draft);

  return {
    status: "success",
    error: null,
    segments: normalizeShotAnalysisSegments(normalizedDraft, scene),
    updatedAt: new Date().toISOString(),
  };
};

const getSceneDurationSeconds = (scene: StoryOutlineSceneRecord) =>
  Math.max(scene.endSeconds - scene.startSeconds, 0.5);

const buildSceneSubtitleReference = (
  material: PersistedMaterial,
  scene: StoryOutlineSceneRecord
) => {
  const rawSrtContent = material.srtContent?.trim();
  if (!rawSrtContent) {
    return "无外部字幕参考";
  }

  const subtitleBlocks = extractSubtitleBlocksInRange(rawSrtContent, {
    startSeconds: scene.startSeconds,
    endSeconds: scene.endSeconds,
  });

  if (subtitleBlocks.length === 0) {
    return "当前场景时间范围内未匹配到外部字幕";
  }

  return subtitleBlocks
    .map((block) => `[${block.timeline}] ${block.content}`)
    .join("\n");
};

const buildUserPrompt = (material: PersistedMaterial, scene: StoryOutlineSceneRecord) => `
请根据以下信息输出该场景的镜头解读。

素材标题：
${material.title}

场景标题：
${scene.title}

场景时间：
${scene.startTimecode} - ${scene.endTimecode}

场景时长：
${getSceneDurationSeconds(scene).toFixed(1)} 秒

当前 scene 在整条视频中的绝对起止秒数：
${scene.startSeconds} - ${scene.endSeconds}

场景文本摘要：
${scene.description}

低置信度外部字幕参考（可能有误，仅在视频中看不清字幕时才可辅助参考）：
${buildSceneSubtitleReference(material, scene)}

请重点从人物动作、表情与眼神、镜头语言、画面氛围、解说价值点这五个维度输出。
请同时给出更细粒度的连续时间切片，切片时间使用相对当前 scene 开头的秒数，而不是整条视频的绝对秒数。
请先观察视频本身，优先识别视频中实际出现的字幕、对白文字、招牌、屏幕字和其他可见文本，再结合动作与构图做判断。
如果视频里识别出的字幕和上面的外部字幕参考不一致，以视频里识别出的字幕为准。
场景文本摘要只用于提供上下文边界，外部字幕参考只能弱辅助，不能覆盖视觉证据。
不要解释象征意义或人物真实意图，也不要简单复述剧情大纲。
`.trim();

const getShotAnalysisFfmpegPath = (settings: PersistedAppSettings) => {
  const resolvedPath = resolveFfmpegExecutable(settings.ffmpegExecutablePath);

  if (!resolvedPath) {
    throw new Error("未找到 ffmpeg。请先在设置页填写 ffmpeg 可执行文件路径。");
  }

  return resolvedPath;
};

const createSceneClipPath = (
  material: PersistedMaterial,
  scene: StoryOutlineSceneRecord,
  settings: PersistedAppSettings
) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "meta-player-shot-analysis-"));
  const outputPath = join(tempDirectory, "scene.mp4");
  const durationSeconds = getSceneDurationSeconds(scene);

  try {
    execFileSync(
      getShotAnalysisFfmpegPath(settings),
      [
        "-y",
        "-ss",
        String(scene.startSeconds),
        "-i",
        material.absolutePath,
        "-t",
        String(durationSeconds),
        "-an",
        "-r",
        "12",
        "-vf",
        "scale='min(960,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "31",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      {
        stdio: "ignore",
      }
    );

    return {
      outputPath,
      cleanup: () => rmSync(tempDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  }
};

const callDashScopeVisionByPython = async (input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fps: number;
  videoPath: string;
  prompt: string;
  responseFormat: typeof sceneShotAnalysisResponseFormat;
  logContext: Record<string, unknown>;
}): Promise<PythonShotAnalysisPayload> => {
  const scriptPath = resolveBundledPythonScriptPath("vision_shot_analysis");
  const pythonExecutable = resolveBundledPythonExecutable();

  if (!scriptPath) {
    throw new Error("未找到镜头解读 Python 脚本，请重新打包应用。");
  }

  if (!pythonExecutable) {
    throw new Error("未找到内置 Python 运行环境，请重新打包应用。");
  }

  return new Promise<PythonShotAnalysisPayload>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    shotAnalysisLogger.info("shot_analysis.python.started", {
      ...input.logContext,
      pythonExecutable,
      scriptPath,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      shotAnalysisLogger.error("shot_analysis.python.spawn_failed", {
        ...input.logContext,
        pythonExecutable,
        scriptPath,
        durationMs: Date.now() - startedAt,
        error: formatErrorForLog(error),
      });
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        shotAnalysisLogger.error("shot_analysis.python.failed", {
          ...input.logContext,
          pythonExecutable,
          scriptPath,
          durationMs: Date.now() - startedAt,
          exitCode: code,
          stderr: stderr.trim() ? truncateForLog(stderr.trim()) : undefined,
          stdoutExcerpt: stdout.trim() ? truncateForLog(stdout.trim()) : undefined,
        });
        reject(new Error(stderr.trim() || "镜头解读 Python 服务执行失败。"));
        return;
      }

      try {
        const payload = JSON.parse(stdout) as PythonShotAnalysisPayload;
        const content = typeof payload.content === "string"
          ? payload.content
          : typeof payload.text === "string"
            ? payload.text
            : "";

        if (!content.trim()) {
          shotAnalysisLogger.error("shot_analysis.python.empty_content", {
            ...input.logContext,
            durationMs: Date.now() - startedAt,
            exitCode: code,
            stdoutExcerpt: stdout.trim() ? truncateForLog(stdout.trim()) : undefined,
            stderr: stderr.trim() ? truncateForLog(stderr.trim()) : undefined,
          });
          reject(new Error("镜头解读 Python 服务未返回有效文本。"));
          return;
        }

        shotAnalysisLogger.info("shot_analysis.python.completed", {
          ...input.logContext,
          durationMs: Date.now() - startedAt,
          exitCode: code,
          stderr: stderr.trim() ? truncateForLog(stderr.trim()) : undefined,
          contentLength: content.trim().length,
        });

        resolve({
          ...payload,
          content: content.trim(),
        });
      } catch (error) {
        shotAnalysisLogger.error("shot_analysis.python.invalid_json", {
          ...input.logContext,
          durationMs: Date.now() - startedAt,
          exitCode: code,
          stdoutExcerpt: stdout.trim() ? truncateForLog(stdout.trim()) : undefined,
          stderr: stderr.trim() ? truncateForLog(stderr.trim()) : undefined,
          error: formatErrorForLog(error),
        });
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
};

const normalizeGeminiBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "");

const normalizeOpenAiCompatibleBaseUrl = (baseUrl: string) =>
  baseUrl.trim().replace(/\/+$/, "");

const getAssistantText = (payload: OpenAiCompatibleChatCompletionResponse): string => {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim()) {
    return content.trim();
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

  throw new Error("grok2api 未返回有效镜头解读内容。");
};

const getOpenAiCompatibleUsage = (usage?: OpenAiCompatibleChatCompletionResponse["usage"]) => ({
  input_tokens:
    typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : usage?.input_tokens,
  output_tokens:
    typeof usage?.completion_tokens === "number"
      ? usage.completion_tokens
      : usage?.output_tokens,
  total_tokens: usage?.total_tokens,
});

const calculateGrok2apiFrameCount = (
  sceneDurationSeconds: number,
  fps: number
) => {
  const estimatedFrameCount = Math.round(sceneDurationSeconds * fps);
  return clampNumber(
    estimatedFrameCount,
    GROK2API_FRAME_MIN_COUNT,
    GROK2API_FRAME_MAX_COUNT
  );
};

const createSceneFrameDirectory = (
  clipPath: string,
  scene: StoryOutlineSceneRecord,
  fps: number,
  settings: PersistedAppSettings
) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "meta-player-shot-analysis-frames-"));
  const framePattern = join(tempDirectory, "frame-%03d.jpg");
  const frameCount = calculateGrok2apiFrameCount(getSceneDurationSeconds(scene), fps);

  try {
    execFileSync(
      getShotAnalysisFfmpegPath(settings),
      [
        "-y",
        "-i",
        clipPath,
        "-vf",
        `fps=${frameCount / getSceneDurationSeconds(scene)},scale='min(960,iw)':-2`,
        "-frames:v",
        String(frameCount),
        "-q:v",
        "3",
        framePattern,
      ],
      {
        stdio: "ignore",
      }
    );

    const framePaths = readdirSync(tempDirectory)
      .filter((filename) => filename.endsWith(".jpg"))
      .sort((left, right) => left.localeCompare(right))
      .map((filename) => join(tempDirectory, filename));

    if (framePaths.length === 0) {
      throw new Error("未能为 grok2api 镜头解读生成可用抽帧。");
    }

    return {
      framePaths,
      cleanup: () => rmSync(tempDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  }
};

const callGrok2apiVision = async (input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  framePaths: string[];
}): Promise<PythonShotAnalysisPayload> => {
  const response = await fetch(`${normalizeOpenAiCompatibleBaseUrl(input.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      response_format: sceneShotAnalysisResponseFormat,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: input.prompt,
            },
            ...input.framePaths.map((framePath) => ({
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${readFileSync(framePath).toString("base64")}`,
              },
            })),
          ],
        },
      ],
    }),
  });

  const payload = (await response.json()) as OpenAiCompatibleChatCompletionResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message?.trim() || "grok2api 镜头解读调用失败。");
  }

  return {
    content: getAssistantText(payload),
    usage: getOpenAiCompatibleUsage(payload.usage),
  };
};

const uploadGeminiVideoFile = async (input: {
  baseUrl: string;
  apiKey: string;
  videoPath: string;
  logContext: Record<string, unknown>;
}) => {
  const fileBytes = readFileSync(input.videoPath);
  const startResponse = await fetch(`${input.baseUrl.replace(/\/v1beta$/, "")}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "x-goog-api-key": input.apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(fileBytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": "video/mp4",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file: {
        display_name: `${input.logContext.sceneId ?? "scene"}-shot-analysis.mp4`,
      },
    }),
  });

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!startResponse.ok || !uploadUrl) {
    const text = await startResponse.text();
    throw new Error(text.trim() || "Gemini 文件上传初始化失败。");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(fileBytes.byteLength),
    },
    body: fileBytes,
  });

  const uploadPayload = (await uploadResponse.json()) as GeminiFileUploadResponse;
  if (!uploadResponse.ok || !uploadPayload.file?.name) {
    throw new Error(uploadPayload.error?.message?.trim() || "Gemini 文件上传失败。");
  }

  return uploadPayload.file;
};

const waitForGeminiFileActive = async (input: {
  baseUrl: string;
  apiKey: string;
  fileName: string;
  timeoutMs: number;
  logContext: Record<string, unknown>;
}) => {
  const startedAt = Date.now();
  let pollCount = 0;
  let lastObservedState: string | null = null;

  while (Date.now() - startedAt < input.timeoutMs) {
    const response = await fetch(`${input.baseUrl}/${input.fileName}`, {
      method: "GET",
      headers: {
        "x-goog-api-key": input.apiKey,
      },
    });
    const payload = (await response.json()) as GeminiFileUploadResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message?.trim() || "Gemini 文件状态查询失败。");
    }

    const state = payload.file?.state?.trim().toUpperCase();
    pollCount += 1;

    if (state && state !== lastObservedState) {
      lastObservedState = state;
      shotAnalysisLogger.info("shot_analysis.gemini.file.state_changed", {
        ...input.logContext,
        fileName: input.fileName,
        state,
        pollCount,
        elapsedMs: Date.now() - startedAt,
      });
    }

    if (state === "ACTIVE") {
      return payload.file;
    }

    if (state === "FAILED") {
      throw new Error("Gemini 视频文件处理失败。");
    }

    await delay(GEMINI_FILE_POLL_INTERVAL_MS);
  }

  shotAnalysisLogger.warn("shot_analysis.gemini.file.wait_timeout", {
    ...input.logContext,
    fileName: input.fileName,
    lastObservedState,
    pollCount,
    timeoutMs: input.timeoutMs,
  });

  throw new Error("Gemini 视频文件处理超时，请稍后重试。");
};

const callGeminiVision = async (input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  videoPath: string;
  prompt: string;
  timeoutMs: number;
  logContext: Record<string, unknown>;
}): Promise<PythonShotAnalysisPayload> => {
  const startedAt = Date.now();
  shotAnalysisLogger.info("shot_analysis.gemini.upload.started", {
    ...input.logContext,
  });

  const uploadedFile = await uploadGeminiVideoFile(input);
  const resolvedFile = uploadedFile.state?.toUpperCase() === "ACTIVE"
    ? uploadedFile
    : await waitForGeminiFileActive({
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        fileName: uploadedFile.name ?? "",
        timeoutMs: input.timeoutMs,
        logContext: input.logContext,
      });

  if (!resolvedFile?.uri) {
    throw new Error("Gemini 文件上传成功，但未返回可用文件地址。");
  }

  shotAnalysisLogger.info("shot_analysis.gemini.upload.completed", {
    ...input.logContext,
    durationMs: Date.now() - startedAt,
    fileName: resolvedFile.name,
    fileUri: resolvedFile.uri,
  });

  const response = await fetch(`${input.baseUrl}/models/${input.model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": input.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                fileUri: resolvedFile.uri,
                mimeType: resolvedFile.mimeType ?? "video/mp4",
              },
            },
            {
              text: input.prompt,
            },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: sceneShotAnalysisResponseFormat.json_schema.schema,
      },
    }),
  });

  const payload = (await response.json()) as GeminiGenerateContentResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message?.trim() || "Gemini 视频理解调用失败。");
  }

  const content = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!content) {
    throw new Error("Gemini 未返回有效镜头解读内容。");
  }

  shotAnalysisLogger.info("shot_analysis.gemini.completed", {
    ...input.logContext,
    durationMs: Date.now() - startedAt,
    contentLength: content.length,
  });

  return {
    content,
    usage: {
      input_tokens: payload.usageMetadata?.promptTokenCount,
      output_tokens: payload.usageMetadata?.candidatesTokenCount,
      total_tokens: payload.usageMetadata?.totalTokenCount,
    },
  };
};

export const generateSceneShotAnalysis = async (input: {
  material: PersistedMaterial;
  scene: StoryOutlineSceneRecord;
  settings: PersistedAppSettings;
}): Promise<SceneShotAnalysis> => {
  const { material, scene, settings } = input;
  const provider = settings.aiVisionProvider ?? "dashscope";
  const baseUrl =
    provider === "gemini"
      ? normalizeGeminiBaseUrl(
          settings.geminiVisionBaseUrl.trim() || DEFAULT_GEMINI_VISION_BASE_URL
        )
      : normalizeOpenAiCompatibleBaseUrl(
          settings.aiVisionBaseUrl.trim() ||
            (provider === "grok2api"
              ? settings.grok2apiBaseUrl.trim() || DEFAULT_GROK2API_BASE_URL
              : DEFAULT_VISION_BASE_URL)
        );
  const apiKey =
    provider === "gemini"
      ? settings.geminiVisionApiKey.trim()
      : settings.aiVisionApiKey.trim();
  const model =
    provider === "gemini"
      ? settings.geminiVisionModelName.trim() || DEFAULT_GEMINI_VISION_MODEL
      : settings.aiVisionModelName.trim() ||
        (provider === "grok2api" ? DEFAULT_GROK2API_VISION_MODEL : DEFAULT_VISION_MODEL);

  if (!apiKey) {
    throw new Error(
      provider === "gemini"
        ? "请先在设置页填写 Gemini API Key。"
        : "请先在设置页填写视觉模型 API Key。"
    );
  }

  const fps = clampVisionFps(settings.aiVisionFps);
  const startedAt = Date.now();
  const geminiFilePollTimeoutMs = getGeminiFilePollTimeoutMs(scene);

  shotAnalysisLogger.info("shot_analysis.started", {
    ...buildShotAnalysisLogContext({
      material,
      scene,
      model,
      baseUrl,
      fps,
    }),
    hasExternalSubtitle: Boolean(material.srtContent?.trim()),
    sceneDurationSeconds: getSceneDurationSeconds(scene),
  });

  let clipOutput:
    | {
        outputPath: string;
        cleanup: () => void;
      }
    | null = null;
  let frameOutput:
    | {
        framePaths: string[];
        cleanup: () => void;
      }
    | null = null;

  try {
    clipOutput = createSceneClipPath(material, scene, settings);
  } catch (error) {
    shotAnalysisLogger.error("shot_analysis.clip_create.failed", {
      ...buildShotAnalysisLogContext({
        material,
        scene,
        model,
        baseUrl,
        fps,
      }),
      durationMs: Date.now() - startedAt,
      error: formatErrorForLog(error),
    });
    throw error;
  }

  const { outputPath, cleanup } = clipOutput;
  const logContext = buildShotAnalysisLogContext({
    material,
    scene,
    model,
    baseUrl,
    fps,
    videoPath: outputPath,
  });

  shotAnalysisLogger.info("shot_analysis.clip_created", {
    ...logContext,
  });

  try {
    const response =
      provider === "gemini"
        ? await callGeminiVision({
            baseUrl,
            apiKey,
            model,
            videoPath: outputPath,
            prompt: `${SHOT_ANALYSIS_SYSTEM_PROMPT}\n\n${buildUserPrompt(material, scene)}`,
            timeoutMs: geminiFilePollTimeoutMs,
            logContext,
          })
        : provider === "grok2api"
          ? await (() => {
              frameOutput = createSceneFrameDirectory(outputPath, scene, fps, settings);

              shotAnalysisLogger.info("shot_analysis.frames_created", {
                ...logContext,
                frameCount: frameOutput.framePaths.length,
              });

              return callGrok2apiVision({
                baseUrl,
                apiKey,
                model,
                prompt: `${SHOT_ANALYSIS_SYSTEM_PROMPT}\n\n${buildUserPrompt(material, scene)}`,
                framePaths: frameOutput.framePaths,
              });
            })()
        : await callDashScopeVisionByPython({
            baseUrl,
            apiKey,
            model,
            fps,
            videoPath: outputPath,
            prompt: `${SHOT_ANALYSIS_SYSTEM_PROMPT}\n\n${buildUserPrompt(material, scene)}`,
            responseFormat: sceneShotAnalysisResponseFormat,
            logContext,
          });
    const rawContent = response.content ?? "";

    shotAnalysisLogger.info("shot_analysis.model_response.received", {
      ...logContext,
      ...summarizeResponseDraft(rawContent),
      usage: response.usage,
    });

    let normalized: SceneShotAnalysis;

    try {
      normalized = normalizeShotAnalysis(parseShotAnalysisDraft(rawContent), scene);
    } catch (error) {
      shotAnalysisLogger.error("shot_analysis.normalize.failed", {
        ...logContext,
        ...summarizeResponseDraft(rawContent),
        error: formatErrorForLog(error),
      });
      throw error;
    }

    const tokenUsage = extractOpenAiTokenUsage({
      usage: response.usage,
    });

    safeRecordAiUsageEvent({
      action: "scene_shot_analysis",
      provider,
      model,
      endpoint: baseUrl,
      status: "success",
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      inputCount: 1,
      materialId: material.id,
      sceneId: scene.id,
      metadata: {
        fps,
        materialTitle: material.title,
        sceneTitle: scene.title,
      },
    });

    shotAnalysisLogger.info("shot_analysis.completed", {
      ...logContext,
      durationMs: Date.now() - startedAt,
      tokenUsage,
    });

    return normalized;
  } catch (error) {
    shotAnalysisLogger.error("shot_analysis.failed", {
      ...logContext,
      durationMs: Date.now() - startedAt,
      error: formatErrorForLog(error),
    });

    safeRecordAiUsageEvent({
      action: "scene_shot_analysis",
      provider,
      model,
      endpoint: baseUrl,
      status: "error",
      errorMessage: error instanceof Error ? error.message : "镜头解读生成失败。",
      inputCount: 1,
      materialId: material.id,
      sceneId: scene.id,
      metadata: {
        fps,
        materialTitle: material.title,
        sceneTitle: scene.title,
      },
    });
    throw error;
  } finally {
    frameOutput?.cleanup();
    cleanup();
    shotAnalysisLogger.info("shot_analysis.cleanup.completed", {
      ...logContext,
      durationMs: Date.now() - startedAt,
    });
  }
};
