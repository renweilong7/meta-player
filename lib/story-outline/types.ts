/**
 * AI 返回并通过校验后的单个场景记录。
 *
 * 说明：
 * - `startSeconds` / `endSeconds` 用于播放器 seek、排序和后续计算。
 * - `startTimecode` / `endTimecode` 用于展示和持久化，避免再次格式化时丢失信息。
 * - `description` 保留为正文摘要，适配当前“剧情大纲”面板和后续编辑能力。
 */
export interface StoryOutlineSceneRecord {
  id: string;
  title: string;
  description: string;
  startSeconds: number;
  endSeconds: number;
  startTimecode: string;
  endTimecode: string;
  shotAnalysis?: SceneShotAnalysis;
}

export type SceneShotAnalysisStatus = "idle" | "loading" | "success" | "error";

export interface SceneShotAnalysisSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  startTimecode: string;
  endTimecode: string;
  summary: string;
  action: string;
  expressionAndGaze: string;
  cinematography: string;
  atmosphere: string;
  commentaryHooks: string;
}

export interface SceneShotAnalysis {
  status: SceneShotAnalysisStatus;
  error?: string | null;
  segments?: SceneShotAnalysisSegment[];
  updatedAt?: string;
}

export interface StorySceneSubtitleEntry {
  id: string;
  startSeconds: number;
  endSeconds: number;
  timeline: string;
  content: string;
}

/**
 * 右侧剧情大纲面板当前所需要的展示模型。
 *
 * 保留单独类型是为了把 UI 拼接字段（如 duration / timestamp）限制在展示层，
 * 避免污染领域模型。
 */
export interface StoryScene {
  id: string;
  title: string;
  description: string;
  duration: string;
  timestamp: string;
  seekTime: number;
  shotAnalysis?: SceneShotAnalysis;
  subtitleEntries?: StorySceneSubtitleEntry[];
}

/**
 * 调用 AI 前的输入内容。
 *
 * 目前只依赖素材标题、剧情简介和 SRT；
 * 后续如果要加入角色信息、镜头清单、风格偏好，可以直接扩展这里。
 */
export interface StoryOutlineGenerationInput {
  mediaTitle: string;
  synopsis: string;
  srtContent: string;
}

/**
 * OpenAI 兼容接口的最小配置。
 *
 * 这里只保留当前实际需要的字段，后续如需接入组织 ID、额外 headers、
 * 自定义模型名或超参数，可以再扩展。
 */
export interface StoryOutlineGenerationConfig {
  provider?: "openai_compatible" | "grok2api";
  baseUrl: string;
  apiKey: string;
  model?: string;
  materialId?: string;
}

/**
 * 素材的大纲提取状态。
 *
 * 单独定义成联合类型，便于：
 * 1. UI 根据状态做显隐和禁用。
 * 2. 后续存储状态、断点恢复或任务队列。
 */
export type OutlineExtractionStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";
