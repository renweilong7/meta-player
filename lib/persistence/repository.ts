import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  ensureOutlineVectorTable,
  getDatabase,
  getDefaultMaterialDirectory,
  getOutlineVectorTableName,
  isSqliteVecAvailable,
  listOutlineVectorTableNames,
} from "@/lib/persistence/database";
import { getDefaultLocalEmbeddingModelDirectory } from "@/lib/runtime/resource-paths";
import {
  AiUsageAction,
  AiUsageProvider,
  AiUsageStatus,
  CrossAssetSwitchMode,
  PersistedAiUsageRecord,
  PersistedAiUsageSnapshot,
  PersistedAiUsageSummary,
  MaterialPatchInput,
  OutlineVectorSearchSupport,
  ProjectEmbeddingModelSource,
  PersistedAppSettings,
  PersistedLibrarySnapshot,
  PersistedMaterial,
  PersistedMaterialMarker,
  PersistedProject,
  PersistedProjectScriptAudio,
  PersistedProjectClip,
  PersistedProjectClipCompilation,
  PersistedProjectScriptMatchResult,
  MaterialMarkerCreateInput,
  MaterialMarkerUpdateInput,
  ProjectCreateInput,
  ProjectUpdateInput,
} from "@/lib/persistence/types";
import { StoryOutlineSceneRecord } from "@/lib/story-outline/types";
import {
  StoryOutlineSearchResult,
  StoryOutlineSearchSegment,
} from "@/lib/story-outline/search";
import { resolveLocalEmbeddingModel } from "@/lib/story-outline/local-embedding";
import { combineProjectScriptState } from "@/lib/project-script/srt";

const SETTINGS_DEFAULTS: PersistedAppSettings = {
  materialSavePath: getDefaultMaterialDirectory(),
  defaultManagedImport: false,
  aiApiBaseUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModelName: "gpt-4o-mini",
  aiVisionBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
  aiVisionApiKey: "",
  aiVisionModelName: "qwen3.6-plus",
  aiVisionFps: "2",
  storySearchProvider: "remote_embedding",
  aiEmbeddingModelName: "text-embedding-3-small",
  localEmbeddingModelDirectory: getDefaultLocalEmbeddingModelDirectory(),
  localEmbeddingModelName: "bge-small-zh",
  aiSearchModelName: "gpt-4o-mini",
  localTtsModelName: "Tingting",
  autoGenerateProjectScriptTts: true,
  crossAssetSwitchMode: "frame_hold",
};

const OUTLINE_PROMPT_VERSION = "v1";
const OUTLINE_PARSER_VERSION = "v1";

type AssetRow = {
  id: string;
  title: string;
  original_filename: string;
  stored_filename: string;
  absolute_path: string;
  content_hash: string;
  storage_mode: "managed" | "referenced";
  file_size: number;
  media_type: "video" | "image";
  duration: string;
  created_at: string;
  updated_at: string;
  synopsis: string | null;
  srt_content: string | null;
  outline_json: string | null;
  outline_status: string | null;
  outline_error: string | null;
  markers_json: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  story_search_provider: PersistedProject["storySearchProvider"];
  embedding_model_source: ProjectEmbeddingModelSource;
  embedding_model_id: string;
  embedding_model_locked: number;
  cross_asset_switch_mode: CrossAssetSwitchMode;
  auto_trim_intro_outro: number;
  intro_trim_seconds: number;
  outro_trim_seconds: number;
  script_srt_content: string | null;
  script_match_results_json: string | null;
  script_audio_filename: string | null;
  script_audio_path: string | null;
  script_audio_size: number | null;
  created_at: string;
  updated_at: string;
  material_ids_json: string;
};

type OutlineSegmentRow = {
  id: string;
  asset_id: string;
  asset_title: string;
  scene_id: string;
  scene_title: string;
  scene_description: string;
  start_seconds: number;
  end_seconds: number;
  timestamp_text: string;
  searchable_text: string;
  embedding_json: string | null;
  embedding_model: string | null;
  embedding_status: "idle" | "loading" | "success" | "error";
  embedding_error: string | null;
  updated_at: string;
};

type OutlineVectorCandidateRow = {
  segment_id: string;
  distance: number;
};

type OutlineVectorRecord = {
  projectId: string;
  assetId: string;
  segmentId: string;
  embeddingModel: string;
  startSeconds: number;
  embedding: number[];
};

type ProjectScriptItemRow = {
  id: string;
  project_id: string;
  line_index: number;
  content: string;
  audio_path: string | null;
  tts_status: "idle" | "loading" | "success" | "error";
  tts_error: string | null;
  created_at: string;
  updated_at: string;
};

type ProjectClipRow = {
  id: string;
  project_id: string;
  script_item_id: string;
  script_content: string;
  label: string;
  source_asset_id: string;
  source_asset_title: string;
  source_start_seconds: number;
  audio_start_seconds: number;
  duration_seconds: number;
  absolute_path: string;
  file_size: number;
  created_at: string;
  updated_at: string;
};

type AiUsageEventRow = {
  id: string;
  action: AiUsageAction;
  provider: AiUsageProvider;
  model: string;
  endpoint: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  input_count: number | null;
  status: AiUsageStatus;
  error_message: string | null;
  project_id: string | null;
  material_id: string | null;
  scene_id: string | null;
  metadata_json: string | null;
  created_at: string;
};

/**
 * 把数据库的 ISO 时间转成更适合当前 UI 的短文本。
 *
 * 这里不做“今天/昨天”这种相对时间，因为它会让持久化结果和当前时区强耦合；
 * 保存绝对时间，展示时转成本地格式，后续做排序和调试更稳定。
 */
const formatAddedAt = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const getPlaceholderThumbnail = (mediaType: "video" | "image", absolutePath: string) => {
  if (mediaType === "image") {
    return absolutePath;
  }

  /**
   * 当前项目还没有视频缩略图生成能力。
   * 这里先统一用占位图，避免把视频文件路径直接塞给 `<img>` 导致加载异常。
   */
  return "/placeholder.jpg";
};

const parseOutlineJson = (raw: string | null): StoryOutlineSceneRecord[] | undefined => {
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as StoryOutlineSceneRecord[];
  } catch {
    return undefined;
  }
};

const parseProjectMaterialIds = (raw: string): string[] => {
  try {
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
};

const parseProjectScriptAudio = (
  row: Pick<
    ProjectRow,
    "script_audio_filename" | "script_audio_path" | "script_audio_size"
  >
): PersistedProjectScriptAudio | undefined => {
  if (
    !row.script_audio_filename ||
    !row.script_audio_path ||
    row.script_audio_size === null
  ) {
    return undefined;
  }

  return {
    filename: row.script_audio_filename,
    absolutePath: row.script_audio_path,
    fileSize: row.script_audio_size,
  };
};

const normalizeTrimSeconds = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(value ?? 0, 0) : 0;

const parseProjectScriptMatchResults = (
  raw: string | null
): Record<string, PersistedProjectScriptMatchResult> | undefined => {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, PersistedProjectScriptMatchResult>;
    const entries = Object.entries(parsed).filter(
      ([key, value]) =>
        Boolean(key) &&
        typeof value?.assetId === "string" &&
        typeof value?.assetTitle === "string" &&
        typeof value?.startSeconds === "number"
    );

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  } catch {
    return undefined;
  }
};

const parseMarkerJson = (raw: string | null): PersistedMaterialMarker[] | undefined => {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as PersistedMaterialMarker[];
    if (!Array.isArray(parsed)) {
      return undefined;
    }

    return parsed.filter(
      (marker): marker is PersistedMaterialMarker =>
        typeof marker?.id === "string" &&
        typeof marker?.time === "number" &&
        typeof marker?.content === "string" &&
        typeof marker?.createdAt === "string" &&
        typeof marker?.updatedAt === "string"
    );
  } catch {
    return undefined;
  }
};

const parseEmbeddingJson = (raw: string | null): number[] | undefined => {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as number[];
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "number")) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
};

const parseAiUsageMetadata = (
  raw: string | null
): PersistedAiUsageRecord["metadata"] | undefined => {
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entries = Object.entries(parsed).filter(
      ([key, value]) =>
        Boolean(key) &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null)
    );

    return entries.length > 0
      ? (Object.fromEntries(entries) as PersistedAiUsageRecord["metadata"])
      : undefined;
  } catch {
    return undefined;
  }
};

const mapRowToAiUsageRecord = (row: AiUsageEventRow): PersistedAiUsageRecord => ({
  id: row.id,
  action: row.action,
  provider: row.provider,
  model: row.model,
  endpoint: row.endpoint,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  totalTokens: row.total_tokens,
  inputCount: row.input_count,
  status: row.status,
  errorMessage: row.error_message,
  projectId: row.project_id,
  materialId: row.material_id,
  sceneId: row.scene_id,
  metadata: parseAiUsageMetadata(row.metadata_json),
  createdAt: row.created_at,
});

const enrichAiUsageRecords = (records: PersistedAiUsageRecord[]): PersistedAiUsageRecord[] => {
  const projects = listProjects();
  const materials = listMaterials();

  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const materialsById = new Map(materials.map((material) => [material.id, material]));

  return records.map((record) => {
    const sourceProject =
      (record.projectId ? projectsById.get(record.projectId) : undefined) ??
      (record.materialId
        ? projects.find((project) => project.materialIds.includes(record.materialId!))
        : undefined);
    const sourceMaterial = record.materialId ? materialsById.get(record.materialId) : undefined;
    const sourceScene = record.sceneId
      ? sourceMaterial?.storyOutline?.find((scene) => scene.id === record.sceneId)
      : undefined;

    const sourceDetail = [
      sourceProject ? `项目：${sourceProject.name}` : null,
      sourceMaterial ? `素材：${sourceMaterial.title}` : null,
      sourceScene ? `剧情：${sourceScene.title}` : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" / ");

    return {
      ...record,
      sourceProjectName: sourceProject?.name ?? null,
      sourceMaterialTitle: sourceMaterial?.title ?? null,
      sourceSceneTitle: sourceScene?.title ?? null,
      sourceDetail: sourceDetail || null,
    };
  });
};

const groupOutlineVectorRecordsByDimension = (records: OutlineVectorRecord[]) => {
  const groups = new Map<number, OutlineVectorRecord[]>();

  for (const record of records) {
    const dimension = record.embedding.length;
    const existing = groups.get(dimension);

    if (existing) {
      existing.push(record);
      continue;
    }

    groups.set(dimension, [record]);
  }

  return groups;
};

const getMaterialFileUrl = (id: string) => `/api/materials/${id}/file`;
const getProjectScriptAudioUrl = (projectId: string, itemId: string) =>
  `/api/projects/${projectId}/script-items/${itemId}/audio`;
const getProjectClipFileUrl = (projectId: string, clipId: string) =>
  `/api/projects/${projectId}/script-clips/${clipId}/file`;

const getProjectClipCompilationFileUrl = (projectId: string, compilationId: string) =>
  `/api/projects/${projectId}/script-clip-compilations/${compilationId}/file`;

const mapRowToMaterial = (row: AssetRow): PersistedMaterial => ({
  id: row.id,
  title: row.title,
  originalFilename: row.original_filename,
  absolutePath: row.absolute_path,
  contentHash: row.content_hash,
  storageMode: row.storage_mode,
  mediaType: row.media_type,
  fileSize: row.file_size,
  duration: row.duration,
  addedAt: formatAddedAt(row.created_at),
  thumbnail:
    row.media_type === "image"
      ? getMaterialFileUrl(row.id)
      : getPlaceholderThumbnail(row.media_type, row.absolute_path),
  /**
   * 持久化素材统一通过同源 HTTP 路由暴露给前端，
   * 避免 `http://localhost` 页面直接读取 `file://` 本地路径时被 Chromium 拦截。
   *
   * 这样播放器、图片预览和后续缩略图能力都可以复用同一条媒体访问通路。
   */
  src: getMaterialFileUrl(row.id),
  synopsis: row.synopsis ?? undefined,
  srtContent: row.srt_content ?? undefined,
  storyOutline: parseOutlineJson(row.outline_json),
  markers: parseMarkerJson(row.markers_json),
  outlineExtractionStatus: (row.outline_status as PersistedMaterial["outlineExtractionStatus"]) ?? "idle",
  outlineExtractionError: row.outline_error ?? null,
});

const mapRowToProjectScriptItem = (
  row: ProjectScriptItemRow
): PersistedProject["scriptItems"][number] => ({
  id: row.id,
  lineIndex: row.line_index,
  content: row.content,
  ttsStatus: row.tts_status,
  ttsError: row.tts_error ?? null,
  audioSrc:
    row.audio_path && row.tts_status === "success"
      ? getProjectScriptAudioUrl(row.project_id, row.id)
      : undefined,
});

const mapRowToProjectClip = (row: ProjectClipRow): PersistedProjectClip => ({
  id: row.id,
  scriptItemId: row.script_item_id,
  scriptContent: row.script_content,
  label: row.label,
  sourceAssetId: row.source_asset_id,
  sourceAssetTitle: row.source_asset_title,
  sourceStartSeconds: row.source_start_seconds,
  audioStartSeconds: row.audio_start_seconds,
  durationSeconds: row.duration_seconds,
  absolutePath: row.absolute_path,
  fileSize: row.file_size,
  src: getProjectClipFileUrl(row.project_id, row.id),
  createdAt: formatAddedAt(row.created_at),
  updatedAt: formatAddedAt(row.updated_at),
});

export function listProjectScriptItemsByProjectId(projectId: string) {
  const database = getDatabase();

  return database
    .prepare(`
      SELECT
        id,
        project_id,
        line_index,
        content,
        audio_path,
        tts_status,
        tts_error,
        created_at,
        updated_at
      FROM project_script_item
      WHERE project_id = ?
      ORDER BY line_index ASC, created_at ASC
    `)
    .all(projectId)
    .map((row) => mapRowToProjectScriptItem(row as ProjectScriptItemRow));
}

export function listProjectClipsByProjectId(projectId: string) {
  const database = getDatabase();

  return database
    .prepare(`
      SELECT
        c.id,
        c.project_id,
        c.script_item_id,
        c.script_content,
        c.label,
        c.source_asset_id,
        c.source_asset_title,
        c.source_start_seconds,
        c.audio_start_seconds,
        c.duration_seconds,
        c.absolute_path,
        c.file_size,
        c.created_at,
        c.updated_at
      FROM project_clip c
      WHERE c.project_id = ?
      ORDER BY c.created_at DESC
    `)
    .all(projectId)
    .map((row) => mapRowToProjectClip(row as ProjectClipRow));
}

const mapRowToProject = (row: ProjectRow): PersistedProject => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  materialIds: parseProjectMaterialIds(row.material_ids_json),
  storySearchProvider: row.story_search_provider ?? "remote_embedding",
  embeddingModelSource: row.embedding_model_source ?? "remote",
  embeddingModelId: row.embedding_model_id,
  embeddingModelLocked: row.embedding_model_locked === 1,
  crossAssetSwitchMode: row.cross_asset_switch_mode ?? "frame_hold",
  autoTrimIntroOutro: row.auto_trim_intro_outro === 1,
  introTrimSeconds: normalizeTrimSeconds(row.intro_trim_seconds),
  outroTrimSeconds: normalizeTrimSeconds(row.outro_trim_seconds),
  scriptSrtContent: row.script_srt_content ?? undefined,
  scriptMatchResults: parseProjectScriptMatchResults(row.script_match_results_json),
  scriptAudio: parseProjectScriptAudio(row),
  scriptItems: listProjectScriptItemsByProjectId(row.id),
  scriptClips: listProjectClipsByProjectId(row.id),
  createdAt: formatAddedAt(row.created_at),
  updatedAt: formatAddedAt(row.updated_at),
});

const mapRowToOutlineSegment = (
  row: OutlineSegmentRow
): StoryOutlineSearchSegment => ({
  id: row.id,
  assetId: row.asset_id,
  assetTitle: row.asset_title,
  sceneId: row.scene_id,
  sceneTitle: row.scene_title,
  sceneDescription: row.scene_description,
  startSeconds: row.start_seconds,
  endSeconds: row.end_seconds,
  timestamp: row.timestamp_text,
  searchableText: row.searchable_text,
  embedding: parseEmbeddingJson(row.embedding_json),
  embeddingModel: row.embedding_model,
});

const ensureDirectory = (directory: string) => {
  mkdirSync(directory, { recursive: true });
};

const toIsoNow = () => new Date().toISOString();

const hashBuffer = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");

const sanitizeExtension = (filename: string) => {
  const extension = extname(filename).toLowerCase();

  if (!extension || extension.length > 12) {
    return "";
  }

  return extension;
};

const probeVideoDurationSeconds = (absolutePath: string) => {
  const stdout = execFileSync("/opt/homebrew/bin/ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    absolutePath,
  ], {
    encoding: "utf8",
  });

  const durationSeconds = Number(stdout.trim());
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("无法读取视频时长，片头片尾裁剪失败。");
  }

  return durationSeconds;
};

const trimImportedVideoBuffer = (input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  introTrimSeconds: number;
  outroTrimSeconds: number;
}) => {
  const tempDirectory = mkdtempSync(join(tmpdir(), "meta-player-trim-"));
  const inputExtension = sanitizeExtension(input.filename) || ".mp4";
  const inputPath = join(tempDirectory, `input${inputExtension}`);
  const outputPath = join(tempDirectory, "output.mp4");

  try {
    writeFileSync(inputPath, input.buffer);
    const durationSeconds = probeVideoDurationSeconds(inputPath);
    const trimDurationSeconds =
      durationSeconds - input.introTrimSeconds - input.outroTrimSeconds;

    if (trimDurationSeconds <= 0.1) {
      throw new Error("片头片尾时长之和不能大于或等于视频总时长。");
    }

    execFileSync("/opt/homebrew/bin/ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-ss",
      String(input.introTrimSeconds),
      "-t",
      String(trimDurationSeconds),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outputPath,
    ], {
      stdio: "ignore",
    });

    return {
      buffer: readFileSync(outputPath),
      filename: input.filename.replace(/\.[^.]+$/, "") + ".mp4",
      mimeType: "video/mp4",
      forceManagedImport: true,
    };
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
};

const parseProjectScriptLines = (raw: string) =>
  raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/**
 * `node:sqlite` 目前只有基础同步接口，没有 ORM 那种事务 helper。
 * 这里封一层最小事务执行器，后续所有写操作都复用这一套。
 */
const runInTransaction = (callback: () => void) => {
  const database = getDatabase();

  database.exec("BEGIN");

  try {
    callback();
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
};

const getOutlineVectorSearchSupportInternal = (): OutlineVectorSearchSupport => {
  if (!isSqliteVecAvailable()) {
    return {
      available: false,
      mode: "keyword_fallback",
      reason: "sqlite_vec_unavailable",
    };
  }

  return {
    available: true,
    mode: "sqlite_vec",
    reason: null,
  };
};

const normalizeProjectEmbeddingConfig = (input: {
  storySearchProvider: PersistedProject["storySearchProvider"];
  embeddingModelSource: ProjectEmbeddingModelSource;
  embeddingModelId: string;
}) => {
  const embeddingModelId = input.embeddingModelId.trim();
  if (!embeddingModelId) {
    throw new Error("项目 Embedding 模型不能为空。");
  }

  if (input.storySearchProvider === "local_embedding") {
    const resolved = resolveLocalEmbeddingModel({
      localEmbeddingModelDirectory: getSettings().localEmbeddingModelDirectory,
      localEmbeddingModelName: embeddingModelId,
    });

    return {
      storySearchProvider: input.storySearchProvider,
      embeddingModelSource: "local" as const,
      embeddingModelId: resolved.id,
    };
  }

  if (input.storySearchProvider === "remote_embedding") {
    return {
      storySearchProvider: input.storySearchProvider,
      embeddingModelSource: "remote" as const,
      embeddingModelId,
    };
  }

  return {
    storySearchProvider: input.storySearchProvider,
    embeddingModelSource: input.embeddingModelSource,
    embeddingModelId,
  };
};

export const listProjectIdsByAssetId = (assetId: string) => {
  const database = getDatabase();

  return (
    database
      .prepare(`
        SELECT project_id
        FROM project_asset
        WHERE asset_id = ?
        ORDER BY project_id ASC
      `)
      .all(assetId) as Array<{ project_id: string }>
  ).map((row) => row.project_id);
};

export const lockProjectEmbeddingConfigByAssetId = (assetId: string) => {
  const database = getDatabase();
  const now = toIsoNow();

  database.prepare(`
    UPDATE project
    SET embedding_model_locked = 1,
        updated_at = ?
    WHERE id IN (
      SELECT project_id
      FROM project_asset
      WHERE asset_id = ?
    )
  `).run(now, assetId);
};

export const lockProjectEmbeddingConfig = (projectId: string) => {
  const database = getDatabase();
  const now = toIsoNow();

  database.prepare(`
    UPDATE project
    SET embedding_model_locked = 1,
        updated_at = ?
    WHERE id = ?
  `).run(now, projectId);
};

const deleteOutlineVectorRowsByColumn = (
  column: "asset_id" | "project_id" | "segment_id",
  value: string
) => {
  if (!isSqliteVecAvailable()) {
    return;
  }

  const database = getDatabase();

  for (const tableName of listOutlineVectorTableNames()) {
    database.prepare(`DELETE FROM ${tableName} WHERE ${column} = ?`).run(value);
  }
};

const insertOutlineVectorRecords = (records: OutlineVectorRecord[]) => {
  if (!isSqliteVecAvailable() || records.length === 0) {
    return 0;
  }

  const database = getDatabase();
  let insertedCount = 0;

  for (const [dimension, groupedRecords] of groupOutlineVectorRecordsByDimension(records)) {
    ensureOutlineVectorTable(dimension);
    const tableName = getOutlineVectorTableName(dimension);
    const insertStatement = database.prepare(`
      INSERT INTO ${tableName} (
        project_id,
        asset_id,
        segment_id,
        embedding_model,
        start_seconds,
        embedding
      ) VALUES (?, ?, ?, ?, ?, vec_f32(?))
    `);

    for (const record of groupedRecords) {
      insertStatement.run(
        record.projectId,
        record.assetId,
        record.segmentId,
        record.embeddingModel,
        record.startSeconds,
        JSON.stringify(record.embedding)
      );
      insertedCount += 1;
    }
  }

  return insertedCount;
};

export const replaceProjectOutlineVectorsForSegment = (input: {
  projectId: string;
  assetId: string;
  segmentId: string;
  embeddingModel: string;
  startSeconds: number;
  embedding: number[];
}) => {
  if (!isSqliteVecAvailable()) {
    return 0;
  }

  let insertedCount = 0;

  runInTransaction(() => {
    const database = getDatabase();

    for (const tableName of listOutlineVectorTableNames()) {
      database
        .prepare(`DELETE FROM ${tableName} WHERE project_id = ? AND segment_id = ?`)
        .run(input.projectId, input.segmentId);
    }

    insertedCount = insertOutlineVectorRecords([
      {
        projectId: input.projectId,
        assetId: input.assetId,
        segmentId: input.segmentId,
        embeddingModel: input.embeddingModel,
        startSeconds: input.startSeconds,
        embedding: input.embedding,
      },
    ]);
  });

  return insertedCount;
};

export const replaceProjectOutlineVectorsForAsset = (input: {
  projectId: string;
  assetId: string;
  embeddingModel: string;
  segments: Array<{
    segmentId: string;
    startSeconds: number;
    embedding: number[];
  }>;
}) => {
  if (!isSqliteVecAvailable()) {
    return 0;
  }

  let insertedCount = 0;

  runInTransaction(() => {
    const database = getDatabase();

    for (const tableName of listOutlineVectorTableNames()) {
      database
        .prepare(
          `DELETE FROM ${tableName} WHERE project_id = ? AND asset_id = ? AND embedding_model = ?`
        )
        .run(input.projectId, input.assetId, input.embeddingModel);
    }

    insertedCount = insertOutlineVectorRecords(
      input.segments.map((segment) => ({
        projectId: input.projectId,
        assetId: input.assetId,
        segmentId: segment.segmentId,
        embeddingModel: input.embeddingModel,
        startSeconds: segment.startSeconds,
        embedding: segment.embedding,
      }))
    );
  });

  return insertedCount;
};

export const countProjectOutlineVectors = (projectId: string, embeddingModel: string) => {
  if (!isSqliteVecAvailable()) {
    return 0;
  }

  const database = getDatabase();

  return listOutlineVectorTableNames().reduce((total, tableName) => {
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count FROM ${tableName} WHERE project_id = ? AND embedding_model = ?`
      )
      .get(projectId, embeddingModel) as { count: number };

    return total + row.count;
  }, 0);
};

const getMediaTypeFromMime = (mimeType: string, filename: string): "video" | "image" => {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  /**
   * 导入流程当前只开放视频和图片。
   * 如果 MIME 缺失，则退回文件扩展名做保底判断。
   */
  const extension = extname(filename).toLowerCase();

  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(extension)) {
    return "image";
  }

  return "video";
};

/**
 * 统一读取 `app_setting` 全量键值。
 *
 * 当前项目里，应用设置和本地授权配置都落在同一张表中：
 * - 设置项更偏用户配置。
 * - 授权项更偏本地缓存的许可快照。
 *
 * 这里返回 `Map` 而不是裸数组，后续读取任意键时可以保持 O(1) 查找，
 * 也避免每个调用点都重复写“遍历数组找 key”的样板代码。
 */
export const readAppSettingMap = () => {
  const database = getDatabase();
  const rows = database
    .prepare("SELECT key, value FROM app_setting")
    .all() as Array<{ key: string; value: string }>;

  return new Map(rows.map((row) => [row.key, row.value]));
};

/**
 * 统一 upsert `app_setting`。
 *
 * 这一层只做最小能力：
 * - 批量写入键值。
 * - 自动更新 `updated_at`。
 *
 * 业务含义由调用方决定，例如：
 * - `materialSavePath` 这类设置项。
 * - `license.mode` 这类授权快照字段。
 */
export const saveAppSettingValues = (entries: Record<string, string>) => {
  const database = getDatabase();
  const now = toIsoNow();
  const statement = database.prepare(`
    INSERT INTO app_setting (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  runInTransaction(() => {
    Object.entries(entries).forEach(([key, value]) => {
      statement.run(key, value, now);
    });
  });
};

export const getSettings = (): PersistedAppSettings => {
  const stored = readAppSettingMap();

  return {
    materialSavePath: stored.get("materialSavePath") ?? SETTINGS_DEFAULTS.materialSavePath,
    defaultManagedImport:
      (stored.get("defaultManagedImport") ?? String(SETTINGS_DEFAULTS.defaultManagedImport)) ===
      "true",
    aiApiBaseUrl: stored.get("aiApiBaseUrl") ?? SETTINGS_DEFAULTS.aiApiBaseUrl,
    aiApiKey: stored.get("aiApiKey") ?? SETTINGS_DEFAULTS.aiApiKey,
    aiModelName: stored.get("aiModelName") ?? SETTINGS_DEFAULTS.aiModelName,
    aiVisionBaseUrl:
      stored.get("aiVisionBaseUrl") ?? SETTINGS_DEFAULTS.aiVisionBaseUrl,
    aiVisionApiKey:
      stored.get("aiVisionApiKey") ?? SETTINGS_DEFAULTS.aiVisionApiKey,
    aiVisionModelName:
      stored.get("aiVisionModelName") ?? SETTINGS_DEFAULTS.aiVisionModelName,
    aiVisionFps: stored.get("aiVisionFps") ?? SETTINGS_DEFAULTS.aiVisionFps,
    storySearchProvider:
      (stored.get("storySearchProvider") as PersistedAppSettings["storySearchProvider"]) ??
      SETTINGS_DEFAULTS.storySearchProvider,
    aiEmbeddingModelName:
      stored.get("aiEmbeddingModelName") ?? SETTINGS_DEFAULTS.aiEmbeddingModelName,
    localEmbeddingModelDirectory:
      stored.get("localEmbeddingModelDirectory") ??
      SETTINGS_DEFAULTS.localEmbeddingModelDirectory,
    localEmbeddingModelName:
      stored.get("localEmbeddingModelName") ?? SETTINGS_DEFAULTS.localEmbeddingModelName,
    aiSearchModelName:
      stored.get("aiSearchModelName") ?? SETTINGS_DEFAULTS.aiSearchModelName,
    localTtsModelName:
      stored.get("localTtsModelName") ?? SETTINGS_DEFAULTS.localTtsModelName,
    autoGenerateProjectScriptTts:
      (stored.get("autoGenerateProjectScriptTts") ??
        String(SETTINGS_DEFAULTS.autoGenerateProjectScriptTts)) === "true",
    crossAssetSwitchMode:
      (stored.get("crossAssetSwitchMode") as PersistedAppSettings["crossAssetSwitchMode"]) ??
      SETTINGS_DEFAULTS.crossAssetSwitchMode,
  };
};

export const saveSettings = (settings: PersistedAppSettings) => {
  saveAppSettingValues({
    materialSavePath: settings.materialSavePath,
    defaultManagedImport: String(settings.defaultManagedImport),
    aiApiBaseUrl: settings.aiApiBaseUrl,
    aiApiKey: settings.aiApiKey,
    aiModelName: settings.aiModelName,
    aiVisionBaseUrl: settings.aiVisionBaseUrl,
    aiVisionApiKey: settings.aiVisionApiKey,
    aiVisionModelName: settings.aiVisionModelName,
    aiVisionFps: settings.aiVisionFps,
    storySearchProvider: settings.storySearchProvider,
    aiEmbeddingModelName: settings.aiEmbeddingModelName,
    localEmbeddingModelDirectory: settings.localEmbeddingModelDirectory,
    localEmbeddingModelName: settings.localEmbeddingModelName,
    aiSearchModelName: settings.aiSearchModelName,
    localTtsModelName: settings.localTtsModelName,
    autoGenerateProjectScriptTts: String(settings.autoGenerateProjectScriptTts),
    crossAssetSwitchMode: settings.crossAssetSwitchMode,
  });

  ensureDirectory(settings.materialSavePath);

  return getSettings();
};

const listAssetRows = (): AssetRow[] => {
  const database = getDatabase();

  return database
    .prepare(`
      SELECT
        a.id,
        a.title,
        a.original_filename,
        a.stored_filename,
        a.absolute_path,
        a.content_hash,
        a.storage_mode,
        a.file_size,
        a.media_type,
        a.duration,
        a.created_at,
        a.updated_at,
        t.synopsis,
        t.srt_content,
        o.outline_json,
        o.status AS outline_status,
        o.error_message AS outline_error,
        (
          SELECT json_group_array(
            json_object(
              'id', m.id,
              'time', m.marker_time,
              'content', m.content,
              'createdAt', m.created_at,
              'updatedAt', m.updated_at
            )
          )
          FROM (
            SELECT *
            FROM asset_marker
            WHERE asset_id = a.id
            ORDER BY marker_time ASC, created_at ASC
          ) m
        ) AS markers_json
      FROM asset a
      LEFT JOIN asset_text_data t ON t.asset_id = a.id
      LEFT JOIN asset_outline o ON o.asset_id = a.id
      ORDER BY a.updated_at DESC, a.created_at DESC
    `)
    .all() as AssetRow[];
};

export const listMaterials = (): PersistedMaterial[] => listAssetRows().map(mapRowToMaterial);

const listProjectRows = (): ProjectRow[] => {
  const database = getDatabase();

  return database
    .prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.story_search_provider,
        p.embedding_model_source,
        p.embedding_model_id,
        p.embedding_model_locked,
        p.cross_asset_switch_mode,
        p.auto_trim_intro_outro,
        p.intro_trim_seconds,
        p.outro_trim_seconds,
        p.script_srt_content,
        p.script_match_results_json,
        p.script_audio_filename,
        p.script_audio_path,
        p.script_audio_size,
        p.created_at,
        p.updated_at,
        COALESCE(
          json_group_array(pa.asset_id) FILTER (WHERE pa.asset_id IS NOT NULL),
          '[]'
        ) AS material_ids_json
      FROM project p
      LEFT JOIN project_asset pa ON pa.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC, p.created_at DESC
    `)
    .all() as ProjectRow[];
};

const getProjectRowById = (id: string) => {
  const database = getDatabase();

  return database
    .prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.story_search_provider,
        p.embedding_model_source,
        p.embedding_model_id,
        p.embedding_model_locked,
        p.cross_asset_switch_mode,
        p.auto_trim_intro_outro,
        p.intro_trim_seconds,
        p.outro_trim_seconds,
        p.script_srt_content,
        p.script_match_results_json,
        p.script_audio_filename,
        p.script_audio_path,
        p.script_audio_size,
        p.created_at,
        p.updated_at,
        COALESCE(
          json_group_array(pa.asset_id) FILTER (WHERE pa.asset_id IS NOT NULL),
          '[]'
        ) AS material_ids_json
      FROM project p
      LEFT JOIN project_asset pa ON pa.project_id = p.id
      WHERE p.id = ?
      GROUP BY p.id
    `)
    .get(id) as ProjectRow | undefined;
};

export const listProjects = (): PersistedProject[] => listProjectRows().map(mapRowToProject);

export const getProjectById = (id: string) => {
  const row = getProjectRowById(id);
  return row ? mapRowToProject(row) : null;
};

export const recordAiUsageEvent = (input: {
  action: AiUsageAction;
  provider: AiUsageProvider;
  model: string;
  endpoint?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  inputCount?: number | null;
  status: AiUsageStatus;
  errorMessage?: string | null;
  projectId?: string | null;
  materialId?: string | null;
  sceneId?: string | null;
  metadata?: PersistedAiUsageRecord["metadata"];
}) => {
  const database = getDatabase();

  database
    .prepare(`
      INSERT INTO ai_usage_event (
        id,
        action,
        provider,
        model,
        endpoint,
        input_tokens,
        output_tokens,
        total_tokens,
        input_count,
        status,
        error_message,
        project_id,
        material_id,
        scene_id,
        metadata_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      randomUUID(),
      input.action,
      input.provider,
      input.model.trim() || "unknown",
      input.endpoint ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.totalTokens ?? null,
      input.inputCount ?? null,
      input.status,
      input.errorMessage ?? null,
      input.projectId ?? null,
      input.materialId ?? null,
      input.sceneId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      new Date().toISOString()
    );
};

export const listAiUsageRecords = (limit = 200): PersistedAiUsageRecord[] => {
  const database = getDatabase();
  const normalizedLimit = Math.max(1, Math.min(limit, 500));

  const rows = database
    .prepare(`
      SELECT
        id,
        action,
        provider,
        model,
        endpoint,
        input_tokens,
        output_tokens,
        total_tokens,
        input_count,
        status,
        error_message,
        project_id,
        material_id,
        scene_id,
        metadata_json,
        created_at
      FROM ai_usage_event
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(normalizedLimit) as AiUsageEventRow[];

  return rows.map(mapRowToAiUsageRecord);
};

export const getAiUsageSummary = (): PersistedAiUsageSummary => {
  const database = getDatabase();
  const row = database
    .prepare(`
      SELECT
        COUNT(*) AS total_calls,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_calls,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_calls,
        SUM(COALESCE(input_tokens, 0)) AS total_input_tokens,
        SUM(COALESCE(output_tokens, 0)) AS total_output_tokens,
        SUM(COALESCE(total_tokens, 0)) AS total_tokens
      FROM ai_usage_event
    `)
    .get() as {
      total_calls: number | null;
      success_calls: number | null;
      error_calls: number | null;
      total_input_tokens: number | null;
      total_output_tokens: number | null;
      total_tokens: number | null;
    };

  return {
    totalCalls: row.total_calls ?? 0,
    successCalls: row.success_calls ?? 0,
    errorCalls: row.error_calls ?? 0,
    totalInputTokens: row.total_input_tokens ?? 0,
    totalOutputTokens: row.total_output_tokens ?? 0,
    totalTokens: row.total_tokens ?? 0,
  };
};

export const getAiUsageSnapshot = (limit = 200): PersistedAiUsageSnapshot => ({
  summary: getAiUsageSummary(),
  records: enrichAiUsageRecords(listAiUsageRecords(limit)),
});

export const listMaterialsByProjectId = (projectId: string): PersistedMaterial[] => {
  const database = getDatabase();
  const rows = database
    .prepare(`
      SELECT
        a.id,
        a.title,
        a.original_filename,
        a.stored_filename,
        a.absolute_path,
        a.content_hash,
        a.storage_mode,
        a.file_size,
        a.media_type,
        a.duration,
        a.created_at,
        a.updated_at,
        t.synopsis,
        t.srt_content,
        o.outline_json,
        o.status AS outline_status,
        o.error_message AS outline_error,
        (
          SELECT json_group_array(
            json_object(
              'id', m.id,
              'time', m.marker_time,
              'content', m.content,
              'createdAt', m.created_at,
              'updatedAt', m.updated_at
            )
          )
          FROM (
            SELECT *
            FROM asset_marker
            WHERE asset_id = a.id
            ORDER BY marker_time ASC, created_at ASC
          ) m
        ) AS markers_json
      FROM asset a
      INNER JOIN project_asset pa ON pa.asset_id = a.id
      LEFT JOIN asset_text_data t ON t.asset_id = a.id
      LEFT JOIN asset_outline o ON o.asset_id = a.id
      WHERE pa.project_id = ?
      ORDER BY a.updated_at DESC, a.created_at DESC
    `)
    .all(projectId) as AssetRow[];

  return rows.map(mapRowToMaterial);
};

const ensureDefaultProjectForExistingMaterials = () => {
  const materials = listMaterials();
  const projects = listProjects();

  if (projects.length > 0 || materials.length === 0) {
    return { materials, projects };
  }

  const project = createProject({
    name: "默认项目",
    description: "由现有素材自动迁移生成。",
    storySearchProvider: getSettings().storySearchProvider,
    embeddingModelSource:
      getSettings().storySearchProvider === "local_embedding" ? "local" : "remote",
    embeddingModelId:
      getSettings().storySearchProvider === "local_embedding"
        ? getSettings().localEmbeddingModelName
        : getSettings().aiEmbeddingModelName,
  });
  const updatedProject = updateProject(project.id, {
    materialIds: materials.map((item) => item.id),
  });

  return {
    materials,
    projects: updatedProject ? [updatedProject] : [project],
  };
};

export const getLibrarySnapshot = (): PersistedLibrarySnapshot => {
  const { materials, projects } = ensureDefaultProjectForExistingMaterials();

  return {
    settings: getSettings(),
    materials,
    projects,
    usage: getAiUsageSnapshot(),
  };
};

const getAssetById = (id: string) => {
  const database = getDatabase();

  return database
    .prepare(`
      SELECT
        a.id,
        a.title,
        a.original_filename,
        a.stored_filename,
        a.absolute_path,
        a.content_hash,
        a.storage_mode,
        a.file_size,
        a.media_type,
        a.duration,
        a.created_at,
        a.updated_at,
        t.synopsis,
        t.srt_content,
        o.outline_json,
        o.status AS outline_status,
        o.error_message AS outline_error,
        (
          SELECT json_group_array(
            json_object(
              'id', m.id,
              'time', m.marker_time,
              'content', m.content,
              'createdAt', m.created_at,
              'updatedAt', m.updated_at
            )
          )
          FROM (
            SELECT *
            FROM asset_marker
            WHERE asset_id = a.id
            ORDER BY marker_time ASC, created_at ASC
          ) m
        ) AS markers_json
      FROM asset a
      LEFT JOIN asset_text_data t ON t.asset_id = a.id
      LEFT JOIN asset_outline o ON o.asset_id = a.id
      WHERE a.id = ?
    `)
    .get(id) as AssetRow | undefined;
};

export const getMaterialById = (id: string): PersistedMaterial | null => {
  const row = getAssetById(id);
  return row ? mapRowToMaterial(row) : null;
};

const getAssetByContentHash = (contentHash: string) => {
  const database = getDatabase();

  return database
    .prepare(`
      SELECT
        a.id,
        a.title,
        a.original_filename,
        a.stored_filename,
        a.absolute_path,
        a.content_hash,
        a.storage_mode,
        a.file_size,
        a.media_type,
        a.duration,
        a.created_at,
        a.updated_at,
        t.synopsis,
        t.srt_content,
        o.outline_json,
        o.status AS outline_status,
        o.error_message AS outline_error,
        (
          SELECT json_group_array(
            json_object(
              'id', m.id,
              'time', m.marker_time,
              'content', m.content,
              'createdAt', m.created_at,
              'updatedAt', m.updated_at
            )
          )
          FROM (
            SELECT *
            FROM asset_marker
            WHERE asset_id = a.id
            ORDER BY marker_time ASC, created_at ASC
          ) m
        ) AS markers_json
      FROM asset a
      LEFT JOIN asset_text_data t ON t.asset_id = a.id
      LEFT JOIN asset_outline o ON o.asset_id = a.id
      WHERE a.content_hash = ?
    `)
    .get(contentHash) as AssetRow | undefined;
};

export const importMaterialFromBuffer = (input: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  originalPath?: string;
  projectImportSettings?: {
    autoTrimIntroOutro: boolean;
    introTrimSeconds: number;
    outroTrimSeconds: number;
  };
}) => {
  const database = getDatabase();
  const settings = getSettings();
  const now = toIsoNow();
  const mediaType = getMediaTypeFromMime(input.mimeType, input.filename);
  const processedInput =
    input.projectImportSettings?.autoTrimIntroOutro && mediaType === "video"
      ? trimImportedVideoBuffer({
          buffer: input.buffer,
          filename: input.filename,
          mimeType: input.mimeType,
          introTrimSeconds: normalizeTrimSeconds(input.projectImportSettings.introTrimSeconds),
          outroTrimSeconds: normalizeTrimSeconds(input.projectImportSettings.outroTrimSeconds),
        })
      : {
          buffer: input.buffer,
          filename: input.filename,
          mimeType: input.mimeType,
          forceManagedImport: false,
        };
  const contentHash = hashBuffer(processedInput.buffer);
  const existing = getAssetByContentHash(contentHash);

  if (existing) {
    database
      .prepare("UPDATE asset SET updated_at = ?, title = ? WHERE id = ?")
      .run(now, input.filename, existing.id);

    const refreshed = getAssetById(existing.id);
    if (!refreshed) {
      throw new Error("素材重复导入后刷新失败。");
    }

    return mapRowToMaterial(refreshed);
  }

  ensureDirectory(settings.materialSavePath);

  const assetId = randomUUID();
  const storedFilename = `${assetId}${sanitizeExtension(processedInput.filename)}`;
  const normalizedOriginalPath = input.originalPath?.trim();
  const shouldForceManagedImport = settings.defaultManagedImport;
  const hasStableOriginalPath =
    Boolean(normalizedOriginalPath) &&
    !shouldForceManagedImport &&
    !processedInput.forceManagedImport;
  const absolutePath = hasStableOriginalPath
    ? normalizedOriginalPath!
    : join(settings.materialSavePath, storedFilename);
  const storageMode: AssetRow["storage_mode"] = hasStableOriginalPath
    ? "referenced"
    : "managed";

  /**
   * 默认优先引用用户原文件，只有拿不到稳定绝对路径时才退回托管复制。
   * 这样可以避免每次导入都额外占用一份视频磁盘空间。
   * 如果全局开启了“默认托管导入素材”，则这里会强制走托管路径。
   */
  if (storageMode === "managed") {
    writeFileSync(absolutePath, processedInput.buffer);
  }

  runInTransaction(() => {
    database.prepare(`
      INSERT INTO asset (
        id,
        title,
        original_filename,
        stored_filename,
        absolute_path,
        content_hash,
        storage_mode,
        file_size,
        media_type,
        duration,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assetId,
      processedInput.filename,
      input.filename,
      storedFilename,
      absolutePath,
      contentHash,
      storageMode,
      processedInput.buffer.byteLength,
      mediaType,
      "00:00",
      now,
      now
    );

    database.prepare(`
      INSERT INTO asset_text_data (asset_id, synopsis, srt_content, updated_at)
      VALUES (?, NULL, NULL, ?)
    `).run(assetId, now);

    database.prepare(`
      INSERT INTO asset_outline (
        asset_id,
        prompt_version,
        parser_version,
        model_name,
        outline_json,
        status,
        error_message,
        updated_at
      ) VALUES (?, ?, ?, NULL, NULL, 'idle', NULL, ?)
    `).run(assetId, OUTLINE_PROMPT_VERSION, OUTLINE_PARSER_VERSION, now);
  });

  const created = getAssetById(assetId);
  if (!created) {
    throw new Error("素材导入成功后读取失败。");
  }

  return mapRowToMaterial(created);
};

export const updateMaterial = (id: string, patch: MaterialPatchInput) => {
  const database = getDatabase();
  const current = getAssetById(id);

  if (!current) {
    return null;
  }

  const now = toIsoNow();
  const existingOutline = parseOutlineJson(current.outline_json);

  const synopsis = patch.synopsis ?? current.synopsis ?? null;
  const srtContent = patch.srtContent ?? current.srt_content ?? null;
  const storyOutline = patch.storyOutline ?? existingOutline ?? null;
  const outlineStatus = patch.outlineExtractionStatus ?? current.outline_status ?? "idle";
  const outlineError =
    patch.outlineExtractionError !== undefined
      ? patch.outlineExtractionError
      : current.outline_error;

  runInTransaction(() => {
    database
      .prepare("UPDATE asset SET updated_at = ? WHERE id = ?")
      .run(now, id);

    database.prepare(`
      INSERT INTO asset_text_data (asset_id, synopsis, srt_content, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        synopsis = excluded.synopsis,
        srt_content = excluded.srt_content,
        updated_at = excluded.updated_at
    `).run(id, synopsis, srtContent, now);

    database.prepare(`
      INSERT INTO asset_outline (
        asset_id,
        prompt_version,
        parser_version,
        model_name,
        outline_json,
        status,
        error_message,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        prompt_version = excluded.prompt_version,
        parser_version = excluded.parser_version,
        model_name = excluded.model_name,
        outline_json = excluded.outline_json,
        status = excluded.status,
        error_message = excluded.error_message,
        updated_at = excluded.updated_at
    `).run(
      id,
      OUTLINE_PROMPT_VERSION,
      OUTLINE_PARSER_VERSION,
      getSettings().aiModelName,
      storyOutline ? JSON.stringify(storyOutline) : null,
      outlineStatus,
      outlineError ?? null,
      now
    );
  });

  const updated = getAssetById(id);
  if (!updated) {
    throw new Error("素材更新后读取失败。");
  }

  return mapRowToMaterial(updated);
};

export const replaceOutlineSegmentsForAsset = (
  assetId: string,
  segments: Array<
    Omit<StoryOutlineSearchSegment, "assetTitle"> & {
      assetTitle: string;
      embedding?: number[];
      embeddingModel?: string | null;
      embeddingStatus?: "idle" | "loading" | "success" | "error";
      embeddingError?: string | null;
    }
  >
) => {
  const database = getDatabase();
  const now = toIsoNow();

  runInTransaction(() => {
    database
      .prepare("DELETE FROM asset_outline_segment WHERE asset_id = ?")
      .run(assetId);

    const insertStatement = database.prepare(`
      INSERT INTO asset_outline_segment (
        id,
        asset_id,
        scene_id,
        scene_title,
        scene_description,
        start_seconds,
        end_seconds,
        timestamp_text,
        searchable_text,
        embedding_json,
        embedding_model,
        embedding_status,
        embedding_error,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const segment of segments) {
      insertStatement.run(
        segment.id,
        assetId,
        segment.sceneId,
        segment.sceneTitle,
        segment.sceneDescription,
        segment.startSeconds,
        segment.endSeconds,
        segment.timestamp,
        segment.searchableText,
        segment.embedding ? JSON.stringify(segment.embedding) : null,
        segment.embeddingModel ?? null,
        segment.embeddingStatus ?? "idle",
        segment.embeddingError ?? null,
        now
      );
    }

    database.prepare("UPDATE asset SET updated_at = ? WHERE id = ?").run(now, assetId);
  });
};

export const replaceOutlineSegmentForAsset = (
  assetId: string,
  segment: Omit<StoryOutlineSearchSegment, "assetTitle"> & {
    assetTitle: string;
    embedding?: number[];
    embeddingModel?: string | null;
    embeddingStatus?: "idle" | "loading" | "success" | "error";
    embeddingError?: string | null;
  }
) => {
  const database = getDatabase();
  const now = toIsoNow();

  runInTransaction(() => {
    database
      .prepare(`
        INSERT INTO asset_outline_segment (
          id,
          asset_id,
          scene_id,
          scene_title,
          scene_description,
          start_seconds,
          end_seconds,
          timestamp_text,
          searchable_text,
          embedding_json,
          embedding_model,
          embedding_status,
          embedding_error,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          asset_id = excluded.asset_id,
          scene_id = excluded.scene_id,
          scene_title = excluded.scene_title,
          scene_description = excluded.scene_description,
          start_seconds = excluded.start_seconds,
          end_seconds = excluded.end_seconds,
          timestamp_text = excluded.timestamp_text,
          searchable_text = excluded.searchable_text,
          embedding_json = excluded.embedding_json,
          embedding_model = excluded.embedding_model,
          embedding_status = excluded.embedding_status,
          embedding_error = excluded.embedding_error,
          updated_at = excluded.updated_at
      `)
      .run(
        segment.id,
        assetId,
        segment.sceneId,
        segment.sceneTitle,
        segment.sceneDescription,
        segment.startSeconds,
        segment.endSeconds,
        segment.timestamp,
        segment.searchableText,
        segment.embedding ? JSON.stringify(segment.embedding) : null,
        segment.embeddingModel ?? null,
        segment.embeddingStatus ?? "idle",
        segment.embeddingError ?? null,
        now
      );

    database.prepare("UPDATE asset SET updated_at = ? WHERE id = ?").run(now, assetId);
  });
};

export const getOutlineVectorSearchSupport = () => getOutlineVectorSearchSupportInternal();

export const removeOutlineVectorsForAsset = (assetId: string) => {
  runInTransaction(() => {
    deleteOutlineVectorRowsByColumn("asset_id", assetId);
  });
};

export const syncOutlineVectorsForAsset = (assetId: string) => {
  const support = getOutlineVectorSearchSupportInternal();

  runInTransaction(() => {
    deleteOutlineVectorRowsByColumn("asset_id", assetId);

    if (!support.available) {
      return;
    }

    const database = getDatabase();
    const projectIds = listProjectIdsByAssetId(assetId);

    if (projectIds.length === 0) {
      return;
    }

    const rows = database
      .prepare(`
        SELECT
          id,
          asset_id,
          start_seconds,
          embedding_model,
          embedding_json
        FROM asset_outline_segment
        WHERE asset_id = ?
          AND embedding_status = 'success'
          AND embedding_json IS NOT NULL
        ORDER BY start_seconds ASC
      `)
      .all(assetId) as Array<{
        id: string;
        asset_id: string;
        start_seconds: number;
        embedding_model: string | null;
        embedding_json: string | null;
      }>;

    const vectorRecords = rows.flatMap((row) => {
      const embedding = parseEmbeddingJson(row.embedding_json);

      if (!embedding || embedding.length === 0) {
        return [];
      }

        return projectIds.map((projectId) => ({
          projectId,
          assetId: row.asset_id,
          segmentId: row.id,
          embeddingModel: row.embedding_model ?? "",
          startSeconds: row.start_seconds,
          embedding,
        }));
    });

    insertOutlineVectorRecords(vectorRecords);
  });

  return support;
};

export const syncOutlineVectorsForProject = (projectId: string) => {
  const support = getOutlineVectorSearchSupportInternal();

  runInTransaction(() => {
    deleteOutlineVectorRowsByColumn("project_id", projectId);

    if (!support.available) {
      return;
    }

    const database = getDatabase();
    const rows = database
      .prepare(`
        SELECT
          s.id,
          s.asset_id,
          s.start_seconds,
          s.embedding_model,
          s.embedding_json
        FROM asset_outline_segment s
        INNER JOIN project_asset pa ON pa.asset_id = s.asset_id
        WHERE pa.project_id = ?
          AND s.embedding_status = 'success'
          AND s.embedding_json IS NOT NULL
        ORDER BY s.start_seconds ASC
      `)
      .all(projectId) as Array<{
        id: string;
        asset_id: string;
        start_seconds: number;
        embedding_model: string | null;
        embedding_json: string | null;
      }>;

    const vectorRecords = rows.flatMap((row) => {
      const embedding = parseEmbeddingJson(row.embedding_json);

      if (!embedding || embedding.length === 0) {
        return [];
      }

        return [
          {
            projectId,
            assetId: row.asset_id,
            segmentId: row.id,
            embeddingModel: row.embedding_model ?? "",
            startSeconds: row.start_seconds,
            embedding,
          },
        ];
    });

    insertOutlineVectorRecords(vectorRecords);
  });

  return support;
};

export const searchOutlineSegmentsByVector = (input: {
  projectId: string;
  embeddingModel: string;
  queryEmbedding: number[];
  limit: number;
}): StoryOutlineSearchResult[] => {
  const support = getOutlineVectorSearchSupportInternal();
  if (!support.available || input.queryEmbedding.length === 0) {
    return [];
  }

  const database = getDatabase();
  const tableName = getOutlineVectorTableName(input.queryEmbedding.length);
  const existingTables = new Set(listOutlineVectorTableNames());

  if (!existingTables.has(tableName)) {
    return [];
  }

  const rows = database
    .prepare(`
      WITH vector_matches AS (
        SELECT
          segment_id,
          distance
        FROM ${tableName}
        WHERE embedding MATCH vec_f32(?)
          AND k = ?
          AND project_id = ?
          AND embedding_model = ?
      )
      SELECT
        s.id,
        s.asset_id,
        a.title AS asset_title,
        s.scene_id,
        s.scene_title,
        s.scene_description,
        s.start_seconds,
        s.end_seconds,
        s.timestamp_text,
        s.searchable_text,
        s.embedding_json,
        vm.distance
      FROM vector_matches vm
      INNER JOIN asset_outline_segment s ON s.id = vm.segment_id
      INNER JOIN asset a ON a.id = s.asset_id
      ORDER BY vm.distance ASC, s.start_seconds ASC
    `)
    .all(
      JSON.stringify(input.queryEmbedding),
      Math.max(1, input.limit),
      input.projectId,
      input.embeddingModel
    ) as Array<
      OutlineSegmentRow & {
        distance: number;
      }
    >;

  return rows.map((row) => ({
    ...mapRowToOutlineSegment(row),
    score: Math.max(0, 1 - row.distance),
  }));
};

export const listOutlineSegmentsByProjectId = (
  projectId: string
): StoryOutlineSearchSegment[] => {
  const database = getDatabase();

  const rows = database
    .prepare(`
      SELECT
        s.id,
        s.asset_id,
        a.title AS asset_title,
        s.scene_id,
        s.scene_title,
        s.scene_description,
        s.start_seconds,
        s.end_seconds,
        s.timestamp_text,
        s.searchable_text,
        s.embedding_json,
        s.embedding_model,
        s.embedding_status,
        s.embedding_error,
        s.updated_at
      FROM asset_outline_segment s
      INNER JOIN asset a ON a.id = s.asset_id
      INNER JOIN project_asset pa ON pa.asset_id = s.asset_id
      WHERE pa.project_id = ?
      ORDER BY a.updated_at DESC, s.start_seconds ASC
    `)
    .all(projectId) as OutlineSegmentRow[];

  return rows.map(mapRowToOutlineSegment);
};

export const updateMaterialMarker = (
  assetId: string,
  markerId: string,
  input: MaterialMarkerUpdateInput
) => {
  const database = getDatabase();
  const current = getAssetById(assetId);

  if (!current) {
    return null;
  }

  const marker = (parseMarkerJson(current.markers_json) ?? []).find(
    (item) => item.id === markerId
  );

  if (!marker) {
    return null;
  }

  const nextTime = input.time ?? marker.time;
  const nextContent =
    input.content !== undefined ? input.content.trim() : marker.content;

  if (!Number.isFinite(nextTime) || nextTime < 0) {
    throw new Error("标记时间无效。");
  }

  if (!nextContent) {
    throw new Error("标记内容不能为空。");
  }

  const now = toIsoNow();

  runInTransaction(() => {
    database.prepare(`
      UPDATE asset_marker
      SET marker_time = ?, content = ?, updated_at = ?
      WHERE id = ? AND asset_id = ?
    `).run(nextTime, nextContent, now, markerId, assetId);

    database.prepare("UPDATE asset SET updated_at = ? WHERE id = ?").run(now, assetId);
  });

  const updated = getAssetById(assetId);
  if (!updated) {
    throw new Error("标记更新后读取素材失败。");
  }

  return mapRowToMaterial(updated);
};

export const deleteMaterialMarker = (assetId: string, markerId: string) => {
  const database = getDatabase();
  const current = getAssetById(assetId);

  if (!current) {
    return false;
  }

  const now = toIsoNow();
  let deleted = false;

  runInTransaction(() => {
    const result = database
      .prepare("DELETE FROM asset_marker WHERE id = ? AND asset_id = ?")
      .run(markerId, assetId);

    deleted = result.changes > 0;

    if (deleted) {
      database.prepare("UPDATE asset SET updated_at = ? WHERE id = ?").run(now, assetId);
    }
  });

  return deleted;
};

export const createMaterialMarker = (assetId: string, input: MaterialMarkerCreateInput) => {
  const database = getDatabase();
  const current = getAssetById(assetId);

  if (!current) {
    return null;
  }

  const normalizedContent = input.content.trim();
  if (!normalizedContent) {
    throw new Error("标记内容不能为空。");
  }

  if (!Number.isFinite(input.time) || input.time < 0) {
    throw new Error("标记时间无效。");
  }

  const markerId = randomUUID();
  const now = toIsoNow();

  runInTransaction(() => {
    database.prepare(`
      INSERT INTO asset_marker (id, asset_id, marker_time, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(markerId, assetId, input.time, normalizedContent, now, now);

    database.prepare("UPDATE asset SET updated_at = ? WHERE id = ?").run(now, assetId);
  });

  const updated = getAssetById(assetId);
  if (!updated) {
    throw new Error("标记创建后读取素材失败。");
  }

  return mapRowToMaterial(updated);
};

export const deleteMaterial = (id: string) => {
  const database = getDatabase();
  const current = getAssetById(id);

  if (!current) {
    return false;
  }

  const now = toIsoNow();

  runInTransaction(() => {
    deleteOutlineVectorRowsByColumn("asset_id", id);

    database.prepare(`
      UPDATE project
      SET updated_at = ?
      WHERE id IN (
        SELECT project_id
        FROM project_asset
        WHERE asset_id = ?
      )
    `).run(now, id);

    database.prepare("DELETE FROM asset WHERE id = ?").run(id);
  });

  /**
   * 物理文件删除放在数据库删除之后：
   * - 数据库是业务真相，优先保证逻辑上素材消失。
   * - 文件删除失败时，不影响主流程，只留下孤儿文件供后续清理。
   */
  if (current.storage_mode === "managed" && existsSync(current.absolute_path)) {
    rmSync(current.absolute_path, { force: true });
  }

  return true;
};

const replaceProjectMaterialIds = (projectId: string, materialIds: string[], now: string) => {
  const database = getDatabase();
  const uniqueMaterialIds = [...new Set(materialIds)];

  database.prepare("DELETE FROM project_asset WHERE project_id = ?").run(projectId);

  if (uniqueMaterialIds.length === 0) {
    return;
  }

  const existingAssets = new Set(
    (
      database
        .prepare(
          `SELECT id FROM asset WHERE id IN (${uniqueMaterialIds.map(() => "?").join(",")})`
        )
        .all(...uniqueMaterialIds) as Array<{ id: string }>
    ).map((row) => row.id)
  );

  const statement = database.prepare(`
    INSERT INTO project_asset (project_id, asset_id, created_at)
    VALUES (?, ?, ?)
  `);

  uniqueMaterialIds
    .filter((assetId) => existingAssets.has(assetId))
    .forEach((assetId) => {
      statement.run(projectId, assetId, now);
    });
};

export const createProject = (input: ProjectCreateInput) => {
  const database = getDatabase();
  const normalizedName = input.name.trim();
  const embeddingConfig = normalizeProjectEmbeddingConfig({
    storySearchProvider: input.storySearchProvider,
    embeddingModelSource: input.embeddingModelSource,
    embeddingModelId: input.embeddingModelId,
  });

  if (!normalizedName) {
    throw new Error("项目名称不能为空。");
  }

  const projectId = randomUUID();
  const now = toIsoNow();

  database.prepare(`
    INSERT INTO project (
      id,
      name,
      description,
      story_search_provider,
      embedding_model_source,
      embedding_model_id,
      embedding_model_locked,
      cross_asset_switch_mode,
      auto_trim_intro_outro,
      intro_trim_seconds,
      outro_trim_seconds,
      script_srt_content,
      script_match_results_json,
      script_audio_filename,
      script_audio_path,
      script_audio_size,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, 'frame_hold', 0, 0, 0, NULL, NULL, NULL, NULL, NULL, ?, ?)
  `).run(
    projectId,
    normalizedName,
    input.description?.trim() || null,
    embeddingConfig.storySearchProvider,
    embeddingConfig.embeddingModelSource,
    embeddingConfig.embeddingModelId,
    now,
    now
  );

  const created = getProjectRowById(projectId);
  if (!created) {
    throw new Error("项目创建后读取失败。");
  }

  return mapRowToProject(created);
};

export const updateProject = (id: string, input: ProjectUpdateInput) => {
  const database = getDatabase();
  const current = getProjectRowById(id);

  if (!current) {
    return null;
  }

  const currentProject = mapRowToProject(current);
  const nextName = input.name !== undefined ? input.name.trim() : currentProject.name;
  const nextDescription =
    input.description !== undefined
      ? input.description.trim() || null
      : current.description;
  const nextMaterialIds =
    input.materialIds !== undefined ? input.materialIds : currentProject.materialIds;
  const nextStorySearchProvider =
    input.storySearchProvider !== undefined
      ? input.storySearchProvider
      : currentProject.storySearchProvider;
  const nextEmbeddingModelSource =
    input.embeddingModelSource !== undefined
      ? input.embeddingModelSource
      : currentProject.embeddingModelSource;
  const nextEmbeddingModelId =
    input.embeddingModelId !== undefined
      ? input.embeddingModelId
      : currentProject.embeddingModelId;
  const nextCrossAssetSwitchMode =
    input.crossAssetSwitchMode !== undefined
      ? input.crossAssetSwitchMode
      : current.cross_asset_switch_mode;
  const nextAutoTrimIntroOutro =
    input.autoTrimIntroOutro !== undefined
      ? input.autoTrimIntroOutro
      : current.auto_trim_intro_outro === 1;
  const nextIntroTrimSeconds =
    input.introTrimSeconds !== undefined
      ? normalizeTrimSeconds(input.introTrimSeconds)
      : normalizeTrimSeconds(current.intro_trim_seconds);
  const nextOutroTrimSeconds =
    input.outroTrimSeconds !== undefined
      ? normalizeTrimSeconds(input.outroTrimSeconds)
      : normalizeTrimSeconds(current.outro_trim_seconds);
  const nextScriptSrtContent =
    input.scriptSrtContent !== undefined
      ? input.scriptSrtContent.trim() || null
      : current.script_srt_content;
  const nextScriptMatchResults =
    input.scriptMatchResults !== undefined
      ? Object.keys(input.scriptMatchResults).length > 0
        ? JSON.stringify(input.scriptMatchResults)
        : null
      : current.script_match_results_json;
  const nextScriptAudio =
    input.scriptAudio !== undefined
      ? input.scriptAudio
      : parseProjectScriptAudio(current) ?? null;
  const now = toIsoNow();

  if (!nextName) {
    throw new Error("项目名称不能为空。");
  }

  const normalizedEmbeddingConfig = normalizeProjectEmbeddingConfig({
    storySearchProvider: nextStorySearchProvider,
    embeddingModelSource: nextEmbeddingModelSource,
    embeddingModelId: nextEmbeddingModelId,
  });
  const embeddingConfigChanged =
    normalizedEmbeddingConfig.storySearchProvider !== currentProject.storySearchProvider ||
    normalizedEmbeddingConfig.embeddingModelSource !== currentProject.embeddingModelSource ||
    normalizedEmbeddingConfig.embeddingModelId !== currentProject.embeddingModelId;

  if (currentProject.embeddingModelLocked && embeddingConfigChanged) {
    throw new Error("项目已经生成过向量索引，不能修改 Embedding 模型。请重建项目。");
  }

  runInTransaction(() => {
    database
      .prepare(`
        UPDATE project
        SET
          name = ?,
          description = ?,
          story_search_provider = ?,
          embedding_model_source = ?,
          embedding_model_id = ?,
          cross_asset_switch_mode = ?,
          auto_trim_intro_outro = ?,
          intro_trim_seconds = ?,
          outro_trim_seconds = ?,
          script_srt_content = ?,
          script_match_results_json = ?,
          script_audio_filename = ?,
          script_audio_path = ?,
          script_audio_size = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        nextName,
        nextDescription,
        normalizedEmbeddingConfig.storySearchProvider,
        normalizedEmbeddingConfig.embeddingModelSource,
        normalizedEmbeddingConfig.embeddingModelId,
        nextCrossAssetSwitchMode,
        nextAutoTrimIntroOutro ? 1 : 0,
        nextIntroTrimSeconds,
        nextOutroTrimSeconds,
        nextScriptSrtContent,
        nextScriptMatchResults,
        nextScriptAudio?.filename ?? null,
        nextScriptAudio?.absolutePath ?? null,
        nextScriptAudio?.fileSize ?? null,
        now,
        id
      );

    if (input.materialIds !== undefined) {
      replaceProjectMaterialIds(id, nextMaterialIds, now);
      deleteOutlineVectorRowsByColumn("project_id", id);
    }
  });

  const updated = getProjectRowById(id);
  if (!updated) {
    throw new Error("项目更新后读取失败。");
  }

  return mapRowToProject(updated);
};

export const replaceProjectScriptItems = (projectId: string, rawContent: string) => {
  const database = getDatabase();
  const settings = getSettings();
  const now = toIsoNow();
  const lines = parseProjectScriptLines(rawContent);
  const outputDirectory = join(settings.materialSavePath, "project-script-tts", projectId);

  if (existsSync(outputDirectory)) {
    rmSync(outputDirectory, { recursive: true, force: true });
  }

  runInTransaction(() => {
    database
      .prepare("DELETE FROM project_script_item WHERE project_id = ?")
      .run(projectId);

    if (lines.length === 0) {
      return;
    }

    const statement = database.prepare(`
      INSERT INTO project_script_item (
        id,
        project_id,
        line_index,
        content,
        audio_path,
        tts_status,
        tts_error,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'idle', NULL, ?, ?)
    `);

    lines.forEach((content, index) => {
      statement.run(randomUUID(), projectId, index, content, now, now);
    });
  });

  return listProjectScriptItemsByProjectId(projectId);
};

export const getProjectScriptItemById = (itemId: string) => {
  const database = getDatabase();

  const row = database
    .prepare(`
      SELECT
        id,
        project_id,
        line_index,
        content,
        audio_path,
        tts_status,
        tts_error,
        created_at,
        updated_at
      FROM project_script_item
      WHERE id = ?
    `)
    .get(itemId) as ProjectScriptItemRow | undefined;

  return row ?? null;
};

export const updateProjectScriptItemTts = (
  itemId: string,
  patch: {
    audioPath?: string | null;
    ttsStatus: ProjectScriptItemRow["tts_status"];
    ttsError?: string | null;
  }
) => {
  const database = getDatabase();
  const now = toIsoNow();

  database
    .prepare(`
      UPDATE project_script_item
      SET
        audio_path = ?,
        tts_status = ?,
        tts_error = ?,
        updated_at = ?
      WHERE id = ?
    `)
    .run(
      patch.audioPath ?? null,
      patch.ttsStatus,
      patch.ttsError ?? null,
      now,
      itemId
    );

  return getProjectScriptItemById(itemId);
};

export const combineProjectScriptItems = (
  projectId: string,
  input: {
    itemIds: string[];
  }
) => {
  const project = getProjectById(projectId);
  if (!project?.scriptSrtContent?.trim()) {
    throw new Error("当前项目还没有可组合的脚本文案。");
  }

  const combinedState = combineProjectScriptState({
    rawContent: project.scriptSrtContent,
    scriptMatchResults: project.scriptMatchResults,
    itemIds: input.itemIds,
  });

  if (!combinedState) {
    throw new Error("只能组合连续选中的文案。");
  }

  const database = getDatabase();
  const now = toIsoNow();
  const firstItemId = input.itemIds[0];
  const removedItemIds = input.itemIds.slice(1);

  runInTransaction(() => {
    database
      .prepare(`
        UPDATE project
        SET
          script_srt_content = ?,
          script_match_results_json = ?,
          updated_at = ?
        WHERE id = ?
      `)
      .run(
        combinedState.scriptSrtContent,
        Object.keys(combinedState.scriptMatchResults).length > 0
          ? JSON.stringify(combinedState.scriptMatchResults)
          : null,
        now,
        projectId
      );

    database
      .prepare(`
        UPDATE project_clip
        SET
          script_item_id = ?,
          script_content = ?,
          updated_at = ?
        WHERE project_id = ? AND script_item_id = ?
      `)
      .run(
        combinedState.combinedItemId,
        combinedState.combinedContent,
        now,
        projectId,
        firstItemId
      );

    const deleteProjectClipStatement = database.prepare(`
      DELETE FROM project_clip
      WHERE project_id = ? AND script_item_id = ?
    `);

    removedItemIds.forEach((itemId) => {
      deleteProjectClipStatement.run(projectId, itemId);
    });

    Object.entries(combinedState.itemIdMap).forEach(([previousItemId, nextItemId]) => {
      if (
        !nextItemId ||
        previousItemId === firstItemId ||
        removedItemIds.includes(previousItemId) ||
        previousItemId === nextItemId
      ) {
        return;
      }

      database
        .prepare(`
          UPDATE project_clip
          SET
            script_item_id = ?,
            updated_at = ?
          WHERE project_id = ? AND script_item_id = ?
        `)
        .run(nextItemId, now, projectId, previousItemId);
    });
  });

  replaceProjectScriptItems(projectId, combinedState.scriptSrtContent);

  return getProjectById(projectId);
};

export const appendMaterialsToProject = (projectId: string, materialIds: string[]) => {
  const current = getProjectRowById(projectId);

  if (!current) {
    return null;
  }

  const project = mapRowToProject(current);

  return updateProject(projectId, {
    materialIds: [...new Set([...project.materialIds, ...materialIds])],
  });
};

const sanitizeClipLabel = (value: string) =>
  value
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24) || "片段";

const escapeFfmpegConcatPath = (value: string) => value.replace(/'/g, "'\\''");

const getProjectClipCompilationDirectory = (projectId: string) => {
  const settings = getSettings();
  return join(settings.materialSavePath, "project-clip-compilations", projectId);
};

const getProjectClipCompilationFileDescriptor = (
  projectId: string,
  compilationId: string
) => {
  const directory = getProjectClipCompilationDirectory(projectId);
  if (!existsSync(directory)) {
    return null;
  }

  const filename = readdirSync(directory).find((item) =>
    item.startsWith(`${compilationId}-`)
  );

  if (!filename) {
    return null;
  }

  return {
    filename,
    absolutePath: join(directory, filename),
  };
};

export const createProjectScriptClip = (input: {
  projectId: string;
  scriptItemId: string;
  scriptContent: string;
  assetId: string;
  startSeconds: number;
  audioStartSeconds: number;
  durationSeconds: number;
  label: string;
}) => {
  const project = getProjectById(input.projectId);
  if (!project) {
    throw new Error("项目不存在。");
  }

  const material = getMaterialById(input.assetId);
  if (!material || material.mediaType !== "video" || !material.absolutePath) {
    throw new Error("当前素材不是可裁剪的视频。");
  }

  if (!project.scriptAudio?.absolutePath) {
    throw new Error("请先导入项目音频。");
  }

  const durationSeconds = Math.max(input.durationSeconds, 0);
  if (durationSeconds <= 0) {
    throw new Error("当前文案条目没有有效音频时长，无法生成片段。");
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), "meta-player-script-clip-"));
  const outputPath = join(tempDirectory, "clip.mp4");

  try {
    execFileSync("/opt/homebrew/bin/ffmpeg", [
      "-y",
      "-ss",
      String(Math.max(input.startSeconds, 0)),
      "-t",
      String(durationSeconds),
      "-i",
      material.absolutePath,
      "-ss",
      String(Math.max(input.audioStartSeconds, 0)),
      "-t",
      String(durationSeconds),
      "-i",
      project.scriptAudio.absolutePath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-c:a",
      "aac",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath,
    ], {
      stdio: "ignore",
    });

    const settings = getSettings();
    const projectClipDirectory = join(settings.materialSavePath, "project-clips");
    ensureDirectory(projectClipDirectory);
    const clipId = randomUUID();
    const storedFilename = `${clipId}-${sanitizeClipLabel(input.label)}.mp4`;
    const storedAbsolutePath = join(projectClipDirectory, storedFilename);
    copyFileSync(outputPath, storedAbsolutePath);

    const stats = statSync(storedAbsolutePath);
    const now = toIsoNow();
    getDatabase()
      .prepare(`
        INSERT INTO project_clip (
          id,
          project_id,
          script_item_id,
          script_content,
          label,
          source_asset_id,
          source_asset_title,
          source_start_seconds,
          audio_start_seconds,
          duration_seconds,
          absolute_path,
          file_size,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        clipId,
        input.projectId,
        input.scriptItemId,
        input.scriptContent.trim(),
        sanitizeClipLabel(input.label),
        input.assetId,
        material.title,
        Math.max(input.startSeconds, 0),
        Math.max(input.audioStartSeconds, 0),
        durationSeconds,
        storedAbsolutePath,
        stats.size,
        now,
        now
      );

    return getProjectById(input.projectId);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
};

export const compileProjectClips = (input: {
  projectId: string;
  clipIds: string[];
  label: string;
}): PersistedProjectClipCompilation => {
  const project = getProjectById(input.projectId);
  if (!project) {
    throw new Error("项目不存在。");
  }

  const normalizedClipIds = input.clipIds.filter(Boolean);
  if (normalizedClipIds.length === 0) {
    throw new Error("当前没有可合成的项目片段。");
  }

  const clipMap = new Map(project.scriptClips.map((clip) => [clip.id, clip]));
  const clips = normalizedClipIds.map((clipId) => {
    const clip = clipMap.get(clipId);
    if (!clip) {
      throw new Error("存在无效的项目片段，无法完成合成。");
    }

    if (!existsSync(clip.absolutePath)) {
      throw new Error(`片段文件不存在：${clip.label}`);
    }

    return clip;
  });

  const tempDirectory = mkdtempSync(join(tmpdir(), "meta-player-clip-compilation-"));
  const concatListPath = join(tempDirectory, "concat.txt");
  const tempOutputPath = join(tempDirectory, "compilation.mp4");

  try {
    writeFileSync(
      concatListPath,
      clips
        .map((clip) => `file '${escapeFfmpegConcatPath(clip.absolutePath)}'`)
        .join("\n"),
      "utf8"
    );

    execFileSync(
      "/opt/homebrew/bin/ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatListPath,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        tempOutputPath,
      ],
      {
        stdio: "ignore",
      }
    );

    const compilationId = randomUUID();
    const safeLabel = sanitizeClipLabel(input.label);
    const compilationDirectory = getProjectClipCompilationDirectory(input.projectId);
    ensureDirectory(compilationDirectory);
    const filename = `${compilationId}-${safeLabel}.mp4`;
    const absolutePath = join(compilationDirectory, filename);
    copyFileSync(tempOutputPath, absolutePath);

    const stats = statSync(absolutePath);
    return {
      id: compilationId,
      label: safeLabel,
      filename,
      fileSize: stats.size,
      absolutePath,
      src: getProjectClipCompilationFileUrl(input.projectId, compilationId),
      createdAt: formatAddedAt(toIsoNow()),
    };
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
};

export const getProjectClipCompilationFileById = (
  projectId: string,
  compilationId: string
) => getProjectClipCompilationFileDescriptor(projectId, compilationId);

export const deleteProject = (id: string) => {
  const database = getDatabase();
  deleteOutlineVectorRowsByColumn("project_id", id);
  const result = database.prepare("DELETE FROM project WHERE id = ?").run(id);

  return result.changes > 0;
};

export const getMaterialFileDescriptor = (id: string) => {
  const current = getAssetById(id);

  if (!current) {
    return null;
  }

  return {
    absolutePath: current.absolute_path,
    mediaType: current.media_type,
    originalFilename: current.original_filename,
    storageMode: current.storage_mode,
  };
};

/**
 * 预留给未来“扫描已有目录导入”的场景。
 *
 * 当前页面导入走上传流，不会用到这个函数；保留它是为了后续 Electron
 * 目录选择接进来后，可以直接复用同一套内容哈希去重逻辑。
 */
export const importMaterialFromPath = (absolutePath: string) => {
  const stats = statSync(absolutePath);

  if (!stats.isFile()) {
    throw new Error("导入路径不是文件。");
  }

  const buffer = readFileSync(absolutePath);
  const copiedFilename = absolutePath.split(/[\\/]/).pop() ?? "unknown.bin";

  return importMaterialFromBuffer({
    buffer,
    filename: copiedFilename,
    mimeType: "",
    originalPath: absolutePath,
  });
};

/**
 * 用于把现有本地文件复制进托管目录。
 * 当前未直接调用，但后续如果要做项目迁移或缓存修复会直接复用。
 */
export const copyMaterialIntoManagedDirectory = (sourcePath: string, targetPath: string) => {
  ensureDirectory(targetPath.split(/[\\/]/).slice(0, -1).join("/") || ".");
  copyFileSync(sourcePath, targetPath);
};
