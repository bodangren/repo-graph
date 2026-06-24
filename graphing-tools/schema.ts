import { Database } from "bun:sqlite";

/**
 * FTS5 virtual table DDL for node search.
 *
 * This SQL is executed defensively: if the local SQLite build does not include
 * FTS5 support, `createSchema` catches the error and continues without it.
 * All search queries must fall back to `LIKE` when `nodes_fts` is absent.
 */
export const FTS5_CREATE_SQL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    id,
    name,
    file_path,
    summary,
    tags,
    content='nodes',
    content_rowid='rowid'
  );
`;

/**
 * FTS5 triggers to keep the virtual table in sync with the `nodes` table.
 * These are only created when FTS5 is available.
 */
export const FTS5_TRIGGERS_SQL = `
  CREATE TRIGGER IF NOT EXISTS nodes_fts_insert AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_fts(rowid, id, name, file_path, summary, tags)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.file_path, NEW.summary, NEW.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_fts_delete AFTER DELETE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, file_path, summary, tags)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.file_path, OLD.summary, OLD.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS nodes_fts_update AFTER UPDATE ON nodes BEGIN
    INSERT INTO nodes_fts(nodes_fts, rowid, id, name, file_path, summary, tags)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.name, OLD.file_path, OLD.summary, OLD.tags);
    INSERT INTO nodes_fts(rowid, id, name, file_path, summary, tags)
    VALUES (NEW.rowid, NEW.id, NEW.name, NEW.file_path, NEW.summary, NEW.tags);
  END;
`;

/**
 * File metadata DDL. Stores per-file scan metadata for freshness tracking.
 *
 * Compatibility: created with `CREATE TABLE IF NOT EXISTS` so existing `graph.db`
 * files gain the table on first `createSchema` call without data loss.
 */
export const FILES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    errors TEXT
  );
`;

/**
 * Index DDL for the `files` table.
 */
export const FILES_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
  CREATE INDEX IF NOT EXISTS idx_files_modified_at ON files(modified_at);
`;

/**
 * Additional index DDL for edge traversal patterns used by affected/impact.
 */
export const EDGE_TRAVERSAL_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_edges_source_type ON edges(source, type);
  CREATE INDEX IF NOT EXISTS idx_edges_target_type ON edges(target, type);
  CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
`;

export function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      summary TEXT,
      tags TEXT,
      complexity TEXT,
      language_notes TEXT,
      layer_id TEXT,
      package_id TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      type TEXT NOT NULL,
      direction TEXT NOT NULL,
      weight REAL DEFAULT 0.5,
      metadata TEXT
    );
    CREATE TABLE IF NOT EXISTS layers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      node_ids TEXT
    );
    CREATE TABLE IF NOT EXISTS tour_steps (
      order_index INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      node_ids TEXT
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // File metadata table (additive — safe for existing graph.db files)
  db.exec(FILES_TABLE_SQL);
  db.exec(FILES_INDEX_SQL);

  // Edge traversal indexes (additive)
  db.exec(EDGE_TRAVERSAL_INDEX_SQL);

  // FTS5 virtual table — defensive: catch and continue if FTS5 is unavailable
  try {
    db.exec(FTS5_CREATE_SQL);
    db.exec(FTS5_TRIGGERS_SQL);
  } catch {
    // FTS5 not available in this SQLite build — search will fall back to LIKE
  }

  // Backward-compat: add metadata column to pre-existing edges tables
  try {
    db.exec(`ALTER TABLE edges ADD COLUMN metadata TEXT`);
  } catch {
    // Column already exists — ignore
  }
}
