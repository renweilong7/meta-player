import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * 统一管理应用内部数据目录。
 *
 * 这里把数据库和默认素材目录都放在工作区下，原因有两个：
 * 1. 当前开发环境对工作区写入最稳定。
 * 2. Electron/Next 本地开发时不依赖额外系统目录权限。
 */
const APP_DATA_DIRECTORY =
  process.env.META_PLAYER_DATA_DIR?.trim() || join(process.cwd(), ".meta-player");
const DATABASE_PATH = join(APP_DATA_DIRECTORY, "meta-player.db");
const DEFAULT_MATERIAL_DIRECTORY = join(APP_DATA_DIRECTORY, "materials");
const SQLITE_VEC_PATH_ENV = "META_PLAYER_SQLITE_VEC_PATH";
const SQLITE_VEC_TABLE_PREFIX = "outline_segment_vec_";

let databaseInstance: DatabaseSync | null = null;
let sqliteVecExtensionLoaded = false;
let sqliteVecExtensionPath: string | null = null;
let sqliteVecLoadError: string | null = null;
const ensuredVectorTableDimensions = new Set<number>();

const ensureAppDataDirectory = () => {
  mkdirSync(APP_DATA_DIRECTORY, { recursive: true });
  mkdirSync(DEFAULT_MATERIAL_DIRECTORY, { recursive: true });
};

const getSqliteVecFilename = () => {
  switch (process.platform) {
    case "darwin":
      return "vec0.dylib";
    case "win32":
      return "vec0.dll";
    default:
      return "vec0.so";
  }
};

const getSqliteVecCandidatePaths = () => {
  const explicitPath = process.env[SQLITE_VEC_PATH_ENV]?.trim();
  const electronResourcesPath = (process as NodeJS.Process & {
    resourcesPath?: string;
  }).resourcesPath;
  const candidates = [
    explicitPath || null,
    join(
      process.cwd(),
      "bin",
      "sqlite-vec",
      `${process.platform}-${process.arch}`,
      getSqliteVecFilename()
    ),
    join(
      process.cwd(),
      "..",
      "sqlite-vec",
      getSqliteVecFilename()
    ),
  ];

  if (electronResourcesPath) {
    candidates.push(join(electronResourcesPath, "sqlite-vec", getSqliteVecFilename()));
    candidates.push(join(electronResourcesPath, "app", "sqlite-vec", getSqliteVecFilename()));
  }

  return candidates.filter((value): value is string => Boolean(value));
};

const loadSqliteVecExtension = (database: DatabaseSync) => {
  const extensionPath = getSqliteVecCandidatePaths().find((candidate) =>
    existsSync(candidate)
  );

  if (!extensionPath) {
    sqliteVecLoadError = `${SQLITE_VEC_PATH_ENV} 未设置，且默认目录中未找到 sqlite-vec 扩展。`;
    return;
  }

  try {
    database.loadExtension(extensionPath);
    sqliteVecExtensionLoaded = true;
    sqliteVecExtensionPath = extensionPath;
    sqliteVecLoadError = null;
  } catch (error) {
    sqliteVecExtensionLoaded = false;
    sqliteVecExtensionPath = extensionPath;
    sqliteVecLoadError =
      error instanceof Error ? error.message : "sqlite-vec 扩展加载失败。";
  }
};

/**
 * 初始化 SQLite schema。
 *
 * 这里不用迁移框架，原因是当前 schema 还很小，直接在启动时执行
 * `CREATE TABLE IF NOT EXISTS` 可读性更高，也更方便先把持久化跑通。
 */
const initializeSchema = (database: DatabaseSync) => {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS asset (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      absolute_path TEXT NOT NULL UNIQUE,
      content_hash TEXT NOT NULL UNIQUE,
      storage_mode TEXT NOT NULL DEFAULT 'managed' CHECK (storage_mode IN ('managed', 'referenced')),
      file_size INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('video', 'image')),
      duration TEXT NOT NULL DEFAULT '00:00',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_text_data (
      asset_id TEXT PRIMARY KEY,
      synopsis TEXT,
      srt_content TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_outline (
      asset_id TEXT PRIMARY KEY,
      prompt_version TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      model_name TEXT,
      outline_json TEXT,
      status TEXT NOT NULL DEFAULT 'idle',
      error_message TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_outline_segment (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      scene_id TEXT NOT NULL,
      scene_title TEXT NOT NULL,
      scene_description TEXT NOT NULL,
      start_seconds INTEGER NOT NULL,
      end_seconds INTEGER NOT NULL,
      timestamp_text TEXT NOT NULL,
      searchable_text TEXT NOT NULL,
      embedding_json TEXT,
      embedding_model TEXT,
      embedding_status TEXT NOT NULL DEFAULT 'idle' CHECK (
        embedding_status IN ('idle', 'loading', 'success', 'error')
      ),
      embedding_error TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_marker (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      marker_time REAL NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_setting (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      story_search_provider TEXT NOT NULL DEFAULT 'remote_embedding',
      embedding_model_source TEXT NOT NULL DEFAULT 'remote',
      embedding_model_id TEXT NOT NULL DEFAULT 'text-embedding-3-small',
      embedding_model_locked INTEGER NOT NULL DEFAULT 0,
      cross_asset_switch_mode TEXT NOT NULL DEFAULT 'frame_hold',
      auto_trim_intro_outro INTEGER NOT NULL DEFAULT 0,
      intro_trim_seconds REAL NOT NULL DEFAULT 0,
      outro_trim_seconds REAL NOT NULL DEFAULT 0,
      script_srt_content TEXT,
      script_match_results_json TEXT,
      script_audio_filename TEXT,
      script_audio_path TEXT,
      script_audio_size INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_asset (
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, asset_id),
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES asset(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_script_item (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      line_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      audio_path TEXT,
      tts_status TEXT NOT NULL DEFAULT 'idle' CHECK (tts_status IN ('idle', 'loading', 'success', 'error')),
      tts_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(project_id, line_index),
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_clip (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      script_item_id TEXT NOT NULL,
      script_content TEXT NOT NULL,
      label TEXT NOT NULL,
      source_asset_id TEXT NOT NULL,
      source_asset_title TEXT NOT NULL,
      source_start_seconds REAL NOT NULL,
      audio_start_seconds REAL NOT NULL,
      duration_seconds REAL NOT NULL,
      absolute_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_asset_updated_at ON asset(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_marker_asset_time ON asset_marker(asset_id, marker_time ASC);
    CREATE INDEX IF NOT EXISTS idx_asset_outline_segment_asset_id ON asset_outline_segment(asset_id);
    CREATE INDEX IF NOT EXISTS idx_project_updated_at ON project(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_asset_asset_id ON project_asset(asset_id);
    CREATE INDEX IF NOT EXISTS idx_project_script_item_project_line ON project_script_item(project_id, line_index ASC);
    CREATE INDEX IF NOT EXISTS idx_project_clip_project_created ON project_clip(project_id, created_at DESC);
  `);

  /**
   * 轻量 schema 迁移：
   * 旧库没有 `storage_mode`，这里在启动时补齐，默认把历史数据视为托管文件。
   */
  const columns = database
    .prepare("PRAGMA table_info(asset)")
    .all() as Array<{ name: string }>;
  const hasStorageModeColumn = columns.some((column) => column.name === "storage_mode");

  if (!hasStorageModeColumn) {
    database.exec(`
      ALTER TABLE asset
      ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'managed'
      CHECK (storage_mode IN ('managed', 'referenced'))
    `);
  }

  const projectColumns = database
    .prepare("PRAGMA table_info(project)")
    .all() as Array<{ name: string }>;
  const ensureProjectColumn = (name: string, definition: string) => {
    if (projectColumns.some((column) => column.name === name)) {
      return;
    }

    database.exec(`ALTER TABLE project ADD COLUMN ${name} ${definition}`);
  };

  ensureProjectColumn("script_srt_content", "TEXT");
  ensureProjectColumn("story_search_provider", "TEXT NOT NULL DEFAULT 'remote_embedding'");
  ensureProjectColumn("embedding_model_source", "TEXT NOT NULL DEFAULT 'remote'");
  ensureProjectColumn("embedding_model_id", "TEXT NOT NULL DEFAULT 'text-embedding-3-small'");
  ensureProjectColumn("embedding_model_locked", "INTEGER NOT NULL DEFAULT 0");
  ensureProjectColumn("cross_asset_switch_mode", "TEXT NOT NULL DEFAULT 'frame_hold'");
  ensureProjectColumn("auto_trim_intro_outro", "INTEGER NOT NULL DEFAULT 0");
  ensureProjectColumn("intro_trim_seconds", "REAL NOT NULL DEFAULT 0");
  ensureProjectColumn("outro_trim_seconds", "REAL NOT NULL DEFAULT 0");
  ensureProjectColumn("script_match_results_json", "TEXT");
  ensureProjectColumn("script_audio_filename", "TEXT");
  ensureProjectColumn("script_audio_path", "TEXT");
  ensureProjectColumn("script_audio_size", "INTEGER");

  const projectClipColumns = database
    .prepare("PRAGMA table_info(project_clip)")
    .all() as Array<{ name: string }>;

  if (
    projectClipColumns.length > 0 &&
    !projectClipColumns.some((column) => column.name === "script_content")
  ) {
    database.exec("ALTER TABLE project_clip ADD COLUMN script_content TEXT NOT NULL DEFAULT ''");
  }

  if (sqliteVecExtensionLoaded) {
    const legacyVectorTables = (
      database
        .prepare(
          `
            SELECT name, sql
            FROM sqlite_master
            WHERE type = 'table'
              AND name LIKE ?
              AND sql IS NOT NULL
              AND sql LIKE '%USING vec0%'
            ORDER BY name ASC
          `
        )
        .all(`${SQLITE_VEC_TABLE_PREFIX}%`) as Array<{ name: string; sql: string }>
    ).filter(
      (row) =>
        !row.sql.includes("embedding_model") || !row.sql.includes("start_seconds FLOAT")
    );

    for (const table of legacyVectorTables) {
      database.exec(`DROP TABLE IF EXISTS ${table.name}`);
    }
  }
};

const normalizeVectorDimension = (dimension: number) => {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("向量维度必须为正整数。");
  }

  return dimension;
};

export const getOutlineVectorTableName = (dimension: number) =>
  `${SQLITE_VEC_TABLE_PREFIX}${normalizeVectorDimension(dimension)}`;

export const listOutlineVectorTableNames = () => {
  const database = getDatabase();

  return (
    database
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
            AND name LIKE ?
            AND sql IS NOT NULL
            AND sql LIKE '%USING vec0%'
          ORDER BY name ASC
        `
      )
      .all(`${SQLITE_VEC_TABLE_PREFIX}%`) as Array<{ name: string }>
  ).map((row) => row.name);
};

export const isSqliteVecAvailable = () => sqliteVecExtensionLoaded;

export const getSqliteVecStatus = () => ({
  available: sqliteVecExtensionLoaded,
  extensionPath: sqliteVecExtensionPath,
  error: sqliteVecLoadError,
});

export const ensureOutlineVectorTable = (dimension: number) => {
  const normalizedDimension = normalizeVectorDimension(dimension);

  if (!sqliteVecExtensionLoaded) {
    return false;
  }

  if (ensuredVectorTableDimensions.has(normalizedDimension)) {
    return true;
  }

  const database = getDatabase();
  const tableName = getOutlineVectorTableName(normalizedDimension);

  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName}
    USING vec0(
      project_id TEXT PARTITION KEY,
      asset_id TEXT,
      segment_id TEXT,
      embedding_model TEXT,
      start_seconds FLOAT,
      embedding FLOAT[${normalizedDimension}] DISTANCE_METRIC=cosine
    )
  `);

  ensuredVectorTableDimensions.add(normalizedDimension);

  return true;
};

export const getDatabase = () => {
  if (databaseInstance) {
    return databaseInstance;
  }

  ensureAppDataDirectory();
  databaseInstance = new DatabaseSync(DATABASE_PATH, {
    allowExtension: true,
  });
  loadSqliteVecExtension(databaseInstance);
  initializeSchema(databaseInstance);
  databaseInstance.enableLoadExtension(false);

  return databaseInstance;
};

export const getDefaultMaterialDirectory = () => DEFAULT_MATERIAL_DIRECTORY;
