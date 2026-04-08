import { OutlineExtractionStatus, StoryOutlineSceneRecord } from "@/lib/story-outline/types";

export type StorySearchProvider =
  | "remote_embedding"
  | "local_embedding"
  | "llm";

export type ProjectEmbeddingModelSource = "remote" | "local";

export type CrossAssetSwitchMode = "frame_hold" | "preload";

export type AiUsageProvider =
  | "openai_compatible"
  | "dashscope"
  | "local_embedding"
  | "system_tts";

export type AiUsageStatus = "success" | "error";

export type AiUsageAction =
  | "story_outline_generation"
  | "story_outline_embedding_index"
  | "story_outline_embedding_search"
  | "story_outline_llm_search"
  | "scene_shot_analysis"
  | "project_script_tts";

export interface PersistedAiUsageRecord {
  id: string;
  action: AiUsageAction;
  provider: AiUsageProvider;
  model: string;
  endpoint: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  inputCount: number | null;
  status: AiUsageStatus;
  errorMessage: string | null;
  projectId: string | null;
  materialId: string | null;
  sceneId: string | null;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface PersistedAiUsageSummary {
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
}

export interface PersistedAiUsageSnapshot {
  summary: PersistedAiUsageSummary;
  records: PersistedAiUsageRecord[];
}

/**
 * 持久化层的应用设置。
 *
 * 这些字段既用于 UI 展示，也用于后端导入流程：
 * - `materialSavePath` 决定素材托管目录。
 * - AI 字段决定剧情大纲生成时的远端配置。
 */
export interface PersistedAppSettings {
  materialSavePath: string;
  defaultManagedImport: boolean;
  aiApiBaseUrl: string;
  aiApiKey: string;
  aiModelName: string;
  aiVisionBaseUrl: string;
  aiVisionApiKey: string;
  aiVisionModelName: string;
  aiVisionFps: string;
  storySearchProvider: StorySearchProvider;
  aiEmbeddingModelName: string;
  localEmbeddingModelDirectory: string;
  localEmbeddingModelName: string;
  aiSearchModelName: string;
  localTtsModelName: string;
  autoGenerateProjectScriptTts: boolean;
  crossAssetSwitchMode: CrossAssetSwitchMode;
}

export interface OutlineVectorSearchSupport {
  available: boolean;
  mode: "sqlite_vec" | "keyword_fallback";
  reason: "sqlite_vec_unavailable" | null;
}

export interface LocalEmbeddingModelOption {
  id: string;
  name: string;
  directoryName: string;
  absolutePath: string;
  source: "bundled" | "custom";
}

/**
 * 数据库存储后的素材实体。
 *
 * 说明：
 * - `contentHash` 是素材身份，不是路径。
 * - `absolutePath` 指向应用托管后的本地文件。
 * - `thumbnail` / `src` 都是给 UI 直接消费的派生字段。
 */
export interface PersistedMaterial {
  id: string;
  title: string;
  originalFilename: string;
  absolutePath: string;
  contentHash: string;
  storageMode: "managed" | "referenced";
  mediaType: "video" | "image";
  fileSize: number;
  duration: string;
  addedAt: string;
  thumbnail: string;
  src?: string;
  synopsis?: string;
  srtContent?: string;
  storyOutline?: StoryOutlineSceneRecord[];
  markers?: PersistedMaterialMarker[];
  outlineExtractionStatus?: OutlineExtractionStatus;
  outlineExtractionError?: string | null;
}

export interface PersistedMaterialMarker {
  id: string;
  time: number;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedProjectScriptAudio {
  filename: string;
  absolutePath: string;
  fileSize: number;
}

export interface PersistedProjectScriptMatchResult {
  assetId: string;
  assetTitle: string;
  startSeconds: number;
}

export type ProjectScriptTtsStatus = "idle" | "loading" | "success" | "error";

export interface PersistedProjectScriptItem {
  id: string;
  lineIndex: number;
  content: string;
  ttsStatus: ProjectScriptTtsStatus;
  ttsError?: string | null;
  audioSrc?: string;
}

export interface PersistedProjectClip {
  id: string;
  scriptItemId: string;
  scriptContent: string;
  label: string;
  sourceAssetId: string;
  sourceAssetTitle: string;
  sourceStartSeconds: number;
  audioStartSeconds: number;
  durationSeconds: number;
  absolutePath: string;
  fileSize: number;
  src: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedProjectClipCompilation {
  id: string;
  label: string;
  filename: string;
  fileSize: number;
  absolutePath: string;
  src: string;
  createdAt: string;
}

export interface PersistedProject {
  id: string;
  name: string;
  description?: string;
  materialIds: string[];
  storySearchProvider: StorySearchProvider;
  embeddingModelSource: ProjectEmbeddingModelSource;
  embeddingModelId: string;
  embeddingModelLocked: boolean;
  crossAssetSwitchMode?: CrossAssetSwitchMode;
  autoTrimIntroOutro?: boolean;
  introTrimSeconds?: number;
  outroTrimSeconds?: number;
  scriptSrtContent?: string;
  scriptAudio?: PersistedProjectScriptAudio;
  scriptMatchResults?: Record<string, PersistedProjectScriptMatchResult>;
  scriptItems: PersistedProjectScriptItem[];
  scriptClips: PersistedProjectClip[];
  createdAt: string;
  updatedAt: string;
}

export interface PersistedLibrarySnapshot {
  settings: PersistedAppSettings;
  materials: PersistedMaterial[];
  projects: PersistedProject[];
  usage: PersistedAiUsageSnapshot;
}

export interface MaterialPatchInput {
  synopsis?: string;
  srtContent?: string;
  storyOutline?: StoryOutlineSceneRecord[];
  outlineExtractionStatus?: OutlineExtractionStatus;
  outlineExtractionError?: string | null;
}

export interface MaterialMarkerCreateInput {
  time: number;
  content: string;
}

export interface MaterialMarkerUpdateInput {
  time?: number;
  content?: string;
}

/**
 * 前端导入时携带的素材来源信息。
 *
 * `originalPath` 仅在 Electron 等桌面环境里可用；
 * 普通浏览器拿不到稳定绝对路径时，服务端会自动退回托管复制。
 */
export interface MaterialImportInput {
  file: File;
  originalPath?: string;
}

export interface ProjectCreateInput {
  name: string;
  description?: string;
  storySearchProvider: StorySearchProvider;
  embeddingModelSource: ProjectEmbeddingModelSource;
  embeddingModelId: string;
}

export interface ProjectUpdateInput {
  name?: string;
  description?: string;
  storySearchProvider?: StorySearchProvider;
  embeddingModelSource?: ProjectEmbeddingModelSource;
  embeddingModelId?: string;
  materialIds?: string[];
  crossAssetSwitchMode?: CrossAssetSwitchMode;
  autoTrimIntroOutro?: boolean;
  introTrimSeconds?: number;
  outroTrimSeconds?: number;
  scriptSrtContent?: string;
  scriptAudio?: PersistedProjectScriptAudio | null;
  scriptMatchResults?: Record<string, PersistedProjectScriptMatchResult>;
}
