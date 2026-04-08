import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistedAppSettings, PersistedMaterial } from "@/lib/persistence/types";
import { extractSubtitleBlocksInRange } from "@/lib/project-script/srt";
import {
  resolveBundledPythonExecutable,
  resolveBundledScriptPath,
} from "@/lib/runtime/resource-paths";
import { SceneShotAnalysis, StoryOutlineSceneRecord } from "@/lib/story-outline/types";
import { safeRecordAiUsageEvent } from "@/lib/model-usage/service";
import { extractOpenAiTokenUsage } from "@/lib/model-usage/usage";

interface ShotAnalysisDraft {
  summary?: unknown;
  action?: unknown;
  expressionAndGaze?: unknown;
  cinematography?: unknown;
  atmosphere?: unknown;
  commentaryHooks?: unknown;
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

const DEFAULT_VISION_BASE_URL = "https://dashscope.aliyuncs.com/api/v1";
const DEFAULT_VISION_MODEL = "qwen3.6-plus";
const DEFAULT_VISION_FPS = 2;
const MIN_VISION_FPS = 0.1;
const MAX_VISION_FPS = 10;

const SHOT_ANALYSIS_SYSTEM_PROMPT = `
你是一个影视场景镜头解读助手。

你的任务是基于用户提供的场景基础信息和视频片段，输出偏元数据、可复用、可检索的结构化结果。

要求：
1. 只返回一个 JSON 对象，不要输出 markdown，不要输出解释文字，不要输出代码块。
2. JSON 必须包含以下字段，且每个字段都是非空字符串：
   - "summary": 1 到 2 句概括这段镜头最值得记录的可见信息。
   - "action": 只描述人物动作、互动和动作变化，不推断动机。
   - "expressionAndGaze": 只描述表情、眼神、视线方向和情绪张力，不解释内心。
   - "cinematography": 描述景别、机位、运镜、构图焦点和前后景关系。
   - "atmosphere": 描述光线、色调、环境状态和整体画面气质。
   - "commentaryHooks": 提炼适合影视解说复用的信息点，强调可见证据，不写象征意义。
3. 严禁输出导演意图、象征意义、隐喻、主题升华等主观阐释。
4. 若视频信息有限，也要基于可观察内容给出谨慎描述，避免编造。
5. 语言简洁、稳定，适合后续作为结构化元数据使用。
6. 你会同时拿到视频片段和一份外部字幕文本，但外部字幕可能包含识别错误、串行、时间错位或污染内容。
7. 你必须优先相信视频中直接可见的信息，包括人物动作、口型对应的画面线索，以及画面里能识别出的字幕、对白文字、屏幕文字。
8. 如果视频里能识别出字幕或屏幕文字，应以视频中识别到的文字为最高优先级；外部字幕只能作为低置信度参考。
9. 如果外部字幕与视频中能识别出的字幕、画面文字或动作线索冲突，忽略外部字幕，不要被其带偏。
10. 如果视频中看不清字幕或根本没有字幕，才可以谨慎参考外部字幕，但不能把外部字幕里缺乏视觉依据的细节当成事实。
`.trim();

const clampVisionFps = (rawValue: string | undefined) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_VISION_FPS;
  }

  return Math.min(MAX_VISION_FPS, Math.max(MIN_VISION_FPS, parsed));
};

const parseShotAnalysisDraft = (rawContent: string) => {
  const normalizedContent = rawContent.trim();

  try {
    return JSON.parse(normalizedContent) as ShotAnalysisDraft;
  } catch {
    const codeBlockMatch = normalizedContent.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (codeBlockMatch?.[1]) {
      return JSON.parse(codeBlockMatch[1].trim()) as ShotAnalysisDraft;
    }
  }

  throw new Error("AI 返回内容不是合法的 JSON 对象。");
};

const requireNonEmptyString = (value: unknown, errorMessage: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(errorMessage);
  }

  return value.trim();
};

const normalizeShotAnalysis = (draft: ShotAnalysisDraft): SceneShotAnalysis => ({
  status: "success",
  error: null,
  summary: requireNonEmptyString(draft.summary, "镜头解读缺少 summary。"),
  action: requireNonEmptyString(draft.action, "镜头解读缺少 action。"),
  expressionAndGaze: requireNonEmptyString(
    draft.expressionAndGaze,
    "镜头解读缺少 expressionAndGaze。"
  ),
  cinematography: requireNonEmptyString(
    draft.cinematography,
    "镜头解读缺少 cinematography。"
  ),
  atmosphere: requireNonEmptyString(draft.atmosphere, "镜头解读缺少 atmosphere。"),
  commentaryHooks: requireNonEmptyString(
    draft.commentaryHooks,
    "镜头解读缺少 commentaryHooks。"
  ),
  updatedAt: new Date().toISOString(),
});

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

场景文本摘要：
${scene.description}

低置信度外部字幕参考（可能有误，仅在视频中看不清字幕时才可辅助参考）：
${buildSceneSubtitleReference(material, scene)}

请重点从人物动作、表情与眼神、镜头语言、画面氛围、解说价值点这五个维度输出。
请先观察视频本身，优先识别视频中实际出现的字幕、对白文字、招牌、屏幕字和其他可见文本，再结合动作与构图做判断。
如果视频里识别出的字幕和上面的外部字幕参考不一致，以视频里识别出的字幕为准。
场景文本摘要只用于提供上下文边界，外部字幕参考只能弱辅助，不能覆盖视觉证据。
不要解释象征意义或人物真实意图，也不要简单复述剧情大纲。
`.trim();

const createSceneClipPath = (material: PersistedMaterial, scene: StoryOutlineSceneRecord) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "meta-player-shot-analysis-"));
  const outputPath = join(tempDirectory, "scene.mp4");
  const durationSeconds = getSceneDurationSeconds(scene);

  try {
    execFileSync(
      "/opt/homebrew/bin/ffmpeg",
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
}): Promise<PythonShotAnalysisPayload> => {
  const scriptPath = resolveBundledScriptPath("vision_shot_analysis.py");
  const pythonExecutable = resolveBundledPythonExecutable();

  if (!scriptPath) {
    throw new Error("未找到镜头解读 Python 脚本，请重新打包应用。");
  }

  if (!pythonExecutable) {
    throw new Error("未找到内置 Python 运行环境，请重新打包应用。");
  }

  return new Promise<PythonShotAnalysisPayload>((resolve, reject) => {
    const child = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
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
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
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
          reject(new Error("镜头解读 Python 服务未返回有效文本。"));
          return;
        }

        resolve({
          ...payload,
          content: content.trim(),
        });
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
};

export const generateSceneShotAnalysis = async (input: {
  material: PersistedMaterial;
  scene: StoryOutlineSceneRecord;
  settings: PersistedAppSettings;
}): Promise<SceneShotAnalysis> => {
  const { material, scene, settings } = input;

  if (!settings.aiVisionApiKey.trim()) {
    throw new Error("请先在设置页填写视觉模型 API Key。");
  }

  const baseUrl = settings.aiVisionBaseUrl.trim() || DEFAULT_VISION_BASE_URL;
  const model = settings.aiVisionModelName.trim() || DEFAULT_VISION_MODEL;
  const fps = clampVisionFps(settings.aiVisionFps);
  const { outputPath, cleanup } = createSceneClipPath(material, scene);

  try {
    const response = await callDashScopeVisionByPython({
      baseUrl,
      apiKey: settings.aiVisionApiKey,
      model,
      fps,
      videoPath: outputPath,
      prompt: `${SHOT_ANALYSIS_SYSTEM_PROMPT}\n\n${buildUserPrompt(material, scene)}`,
    });
    const normalized = normalizeShotAnalysis(parseShotAnalysisDraft(response.content ?? ""));
    const tokenUsage = extractOpenAiTokenUsage({
      usage: response.usage,
    });

    safeRecordAiUsageEvent({
      action: "scene_shot_analysis",
      provider: "dashscope",
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

    return normalized;
  } catch (error) {
    safeRecordAiUsageEvent({
      action: "scene_shot_analysis",
      provider: "dashscope",
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
    cleanup();
  }
};
