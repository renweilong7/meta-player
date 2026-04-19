import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServerLogger } from "@/lib/observability/logger";
import { getAppDataDirectory } from "@/lib/runtime/resource-paths";

const APP_DATA_DIRECTORY = getAppDataDirectory();
const DATABASE_PATH = join(APP_DATA_DIRECTORY, "meta-player.db");
const DEFAULT_MATERIAL_DIRECTORY = join(APP_DATA_DIRECTORY, "materials");
const LEGACY_VECTOR_TABLE_PREFIX = "outline_segment_vec_";
const logger = createServerLogger("server", {
  component: "database",
});

let databaseInstance: DatabaseSync | null = null;

const ensureAppDataDirectory = () => {
  mkdirSync(APP_DATA_DIRECTORY, { recursive: true });
  mkdirSync(DEFAULT_MATERIAL_DIRECTORY, { recursive: true });
  logger.info("database.directories.ready", {
    appDataDirectory: APP_DATA_DIRECTORY,
    materialDirectory: DEFAULT_MATERIAL_DIRECTORY,
  });
};

const purgeLegacyVectorSchema = (database: DatabaseSync) => {
  const legacyEntries = database
    .prepare(
      `
        SELECT type, name, sql
        FROM sqlite_master
        WHERE name LIKE ?
           OR (sql IS NOT NULL AND sql LIKE '%USING vec0(%')
        ORDER BY type ASC, name ASC
      `
    )
    .all(`${LEGACY_VECTOR_TABLE_PREFIX}%`) as Array<{
      type: string;
      name: string;
      sql: string | null;
    }>;

  if (legacyEntries.length === 0) {
    return;
  }

  logger.warn("database.legacy_vector_schema_detected", {
    names: legacyEntries.map((entry) => entry.name),
  });

  const mainVirtualTables = legacyEntries.filter(
    (entry) => entry.sql?.includes("USING vec0(") && entry.type === "table"
  );

  let needsWritableSchemaFallback = mainVirtualTables.length > 0;

  for (const entry of legacyEntries) {
    if (entry.type !== "table") {
      continue;
    }

    try {
      database.exec(`DROP TABLE IF EXISTS "${entry.name.replaceAll("\"", "\"\"")}"`);
    } catch (error) {
      needsWritableSchemaFallback = true;
      logger.warn("database.legacy_vector_schema_drop_failed", {
        name: entry.name,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  if (!needsWritableSchemaFallback) {
    return;
  }

  const currentSchemaVersionRow = database
    .prepare("PRAGMA schema_version")
    .get() as { schema_version: number };
  const nextSchemaVersion = (currentSchemaVersionRow?.schema_version ?? 0) + 1;

  database.exec("PRAGMA writable_schema = ON");
  database
    .prepare(
      `
        DELETE FROM sqlite_master
        WHERE name LIKE ?
           OR (sql IS NOT NULL AND sql LIKE '%USING vec0(%')
      `
    )
    .run(`${LEGACY_VECTOR_TABLE_PREFIX}%`);
  database.exec("PRAGMA writable_schema = OFF");
  database.exec(`PRAGMA schema_version = ${nextSchemaVersion}`);
  database.exec("VACUUM");

  logger.info("database.legacy_vector_schema_purged", {
    names: legacyEntries.map((entry) => entry.name),
  });
};

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
      story_search_provider TEXT NOT NULL DEFAULT 'keyword',
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

    CREATE TABLE IF NOT EXISTS ai_usage_event (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      endpoint TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      input_count INTEGER,
      status TEXT NOT NULL CHECK (status IN ('success', 'error')),
      error_message TEXT,
      project_id TEXT,
      material_id TEXT,
      scene_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_asset_updated_at ON asset(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_marker_asset_time ON asset_marker(asset_id, marker_time ASC);
    CREATE INDEX IF NOT EXISTS idx_asset_outline_segment_asset_id ON asset_outline_segment(asset_id);
    CREATE INDEX IF NOT EXISTS idx_project_updated_at ON project(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_asset_asset_id ON project_asset(asset_id);
    CREATE INDEX IF NOT EXISTS idx_project_script_item_project_line ON project_script_item(project_id, line_index ASC);
    CREATE INDEX IF NOT EXISTS idx_project_clip_project_created ON project_clip(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_event_created_at ON ai_usage_event(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_event_action_created_at ON ai_usage_event(action, created_at DESC);
  `);

  const assetColumns = database
    .prepare("PRAGMA table_info(asset)")
    .all() as Array<{ name: string }>;
  if (!assetColumns.some((column) => column.name === "storage_mode")) {
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

  ensureProjectColumn("story_search_provider", "TEXT NOT NULL DEFAULT 'keyword'");
  ensureProjectColumn("cross_asset_switch_mode", "TEXT NOT NULL DEFAULT 'frame_hold'");
  ensureProjectColumn("auto_trim_intro_outro", "INTEGER NOT NULL DEFAULT 0");
  ensureProjectColumn("intro_trim_seconds", "REAL NOT NULL DEFAULT 0");
  ensureProjectColumn("outro_trim_seconds", "REAL NOT NULL DEFAULT 0");
  ensureProjectColumn("script_srt_content", "TEXT");
  ensureProjectColumn("script_match_results_json", "TEXT");
  ensureProjectColumn("script_audio_filename", "TEXT");
  ensureProjectColumn("script_audio_path", "TEXT");
  ensureProjectColumn("script_audio_size", "INTEGER");

  database.exec(`
    UPDATE project
    SET story_search_provider = 'keyword'
    WHERE story_search_provider IN ('remote_embedding', 'local_embedding')
       OR story_search_provider IS NULL
       OR TRIM(story_search_provider) = ''
  `);

  const projectClipColumns = database
    .prepare("PRAGMA table_info(project_clip)")
    .all() as Array<{ name: string }>;
  if (
    projectClipColumns.length > 0 &&
    !projectClipColumns.some((column) => column.name === "script_content")
  ) {
    database.exec("ALTER TABLE project_clip ADD COLUMN script_content TEXT NOT NULL DEFAULT ''");
  }

  purgeLegacyVectorSchema(database);
};

export const getDatabase = () => {
  if (databaseInstance) {
    return databaseInstance;
  }

  ensureAppDataDirectory();
  databaseInstance = new DatabaseSync(DATABASE_PATH);
  initializeSchema(databaseInstance);
  logger.info("database.ready", {
    databasePath: DATABASE_PATH,
  });

  return databaseInstance;
};

export const getDefaultMaterialDirectory = () => DEFAULT_MATERIAL_DIRECTORY;
