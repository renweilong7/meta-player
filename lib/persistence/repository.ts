import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { getDatabase, getDefaultMaterialDirectory } from "@/lib/persistence/database";
import {
  MaterialPatchInput,
  PersistedAppSettings,
  PersistedLibrarySnapshot,
  PersistedMaterial,
  PersistedMaterialMarker,
  PersistedProject,
  MaterialMarkerCreateInput,
  MaterialMarkerUpdateInput,
  ProjectCreateInput,
  ProjectUpdateInput,
} from "@/lib/persistence/types";
import { StoryOutlineSceneRecord } from "@/lib/story-outline/types";
import { StoryOutlineSearchSegment } from "@/lib/story-outline/search";

const SETTINGS_DEFAULTS: PersistedAppSettings = {
  materialSavePath: getDefaultMaterialDirectory(),
  defaultManagedImport: false,
  aiApiBaseUrl: "https://api.openai.com/v1",
  aiApiKey: "",
  aiModelName: "gpt-4o-mini",
  storySearchProvider: "remote_embedding",
  aiEmbeddingModelName: "text-embedding-3-small",
  localEmbeddingModelName: "bge-small-zh",
  aiSearchModelName: "gpt-4o-mini",
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

const getMaterialFileUrl = (id: string) => `/api/materials/${id}/file`;

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

const mapRowToProject = (row: ProjectRow): PersistedProject => ({
  id: row.id,
  name: row.name,
  description: row.description ?? undefined,
  materialIds: parseProjectMaterialIds(row.material_ids_json),
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
    storySearchProvider:
      (stored.get("storySearchProvider") as PersistedAppSettings["storySearchProvider"]) ??
      SETTINGS_DEFAULTS.storySearchProvider,
    aiEmbeddingModelName:
      stored.get("aiEmbeddingModelName") ?? SETTINGS_DEFAULTS.aiEmbeddingModelName,
    localEmbeddingModelName:
      stored.get("localEmbeddingModelName") ?? SETTINGS_DEFAULTS.localEmbeddingModelName,
    aiSearchModelName:
      stored.get("aiSearchModelName") ?? SETTINGS_DEFAULTS.aiSearchModelName,
  };
};

export const saveSettings = (settings: PersistedAppSettings) => {
  saveAppSettingValues({
    materialSavePath: settings.materialSavePath,
    defaultManagedImport: String(settings.defaultManagedImport),
    aiApiBaseUrl: settings.aiApiBaseUrl,
    aiApiKey: settings.aiApiKey,
    aiModelName: settings.aiModelName,
    storySearchProvider: settings.storySearchProvider,
    aiEmbeddingModelName: settings.aiEmbeddingModelName,
    localEmbeddingModelName: settings.localEmbeddingModelName,
    aiSearchModelName: settings.aiSearchModelName,
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
}) => {
  const database = getDatabase();
  const settings = getSettings();
  const now = toIsoNow();
  const contentHash = hashBuffer(input.buffer);
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
  const storedFilename = `${assetId}${sanitizeExtension(input.filename)}`;
  const normalizedOriginalPath = input.originalPath?.trim();
  const shouldForceManagedImport = settings.defaultManagedImport;
  const hasStableOriginalPath =
    Boolean(normalizedOriginalPath) && !shouldForceManagedImport;
  const absolutePath = hasStableOriginalPath
    ? normalizedOriginalPath!
    : join(settings.materialSavePath, storedFilename);
  const mediaType = getMediaTypeFromMime(input.mimeType, input.filename);
  const storageMode: AssetRow["storage_mode"] = hasStableOriginalPath
    ? "referenced"
    : "managed";

  /**
   * 默认优先引用用户原文件，只有拿不到稳定绝对路径时才退回托管复制。
   * 这样可以避免每次导入都额外占用一份视频磁盘空间。
   * 如果全局开启了“默认托管导入素材”，则这里会强制走托管路径。
   */
  if (storageMode === "managed") {
    writeFileSync(absolutePath, input.buffer);
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
      input.filename,
      input.filename,
      storedFilename,
      absolutePath,
      contentHash,
      storageMode,
      input.buffer.byteLength,
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

  if (!normalizedName) {
    throw new Error("项目名称不能为空。");
  }

  const projectId = randomUUID();
  const now = toIsoNow();

  database.prepare(`
    INSERT INTO project (id, name, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(projectId, normalizedName, input.description?.trim() || null, now, now);

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
  const now = toIsoNow();

  if (!nextName) {
    throw new Error("项目名称不能为空。");
  }

  runInTransaction(() => {
    database
      .prepare("UPDATE project SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(nextName, nextDescription, now, id);

    if (input.materialIds !== undefined) {
      replaceProjectMaterialIds(id, nextMaterialIds, now);
    }
  });

  const updated = getProjectRowById(id);
  if (!updated) {
    throw new Error("项目更新后读取失败。");
  }

  return mapRowToProject(updated);
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

export const deleteProject = (id: string) => {
  const database = getDatabase();
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
