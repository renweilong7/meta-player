import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * 统一管理应用内部数据目录。
 *
 * 这里把数据库和默认素材目录都放在工作区下，原因有两个：
 * 1. 当前开发环境对工作区写入最稳定。
 * 2. Electron/Next 本地开发时不依赖额外系统目录权限。
 */
const APP_DATA_DIRECTORY = join(process.cwd(), ".meta-player");
const DATABASE_PATH = join(APP_DATA_DIRECTORY, "meta-player.db");
const DEFAULT_MATERIAL_DIRECTORY = join(APP_DATA_DIRECTORY, "materials");

let databaseInstance: DatabaseSync | null = null;

const ensureAppDataDirectory = () => {
  mkdirSync(APP_DATA_DIRECTORY, { recursive: true });
  mkdirSync(DEFAULT_MATERIAL_DIRECTORY, { recursive: true });
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

    CREATE INDEX IF NOT EXISTS idx_asset_updated_at ON asset(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_marker_asset_time ON asset_marker(asset_id, marker_time ASC);
    CREATE INDEX IF NOT EXISTS idx_asset_outline_segment_asset_id ON asset_outline_segment(asset_id);
    CREATE INDEX IF NOT EXISTS idx_project_updated_at ON project(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_asset_asset_id ON project_asset(asset_id);
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
};

export const getDatabase = () => {
  if (databaseInstance) {
    return databaseInstance;
  }

  ensureAppDataDirectory();
  databaseInstance = new DatabaseSync(DATABASE_PATH);
  initializeSchema(databaseInstance);

  return databaseInstance;
};

export const getDefaultMaterialDirectory = () => DEFAULT_MATERIAL_DIRECTORY;
