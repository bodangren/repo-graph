import { Database } from "bun:sqlite";

export function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id             TEXT PRIMARY KEY,
      type           TEXT NOT NULL,
      name           TEXT NOT NULL,
      file_path      TEXT,
      summary        TEXT,
      tags           TEXT,
      complexity     TEXT,
      language_notes TEXT,
      layer_id       TEXT
    );

    CREATE TABLE IF NOT EXISTS edges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source      TEXT NOT NULL,
      target      TEXT NOT NULL,
      type        TEXT NOT NULL,
      direction   TEXT NOT NULL,
      weight      REAL DEFAULT 0.5
    );

    CREATE TABLE IF NOT EXISTS layers (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT,
      node_ids    TEXT
    );

    CREATE TABLE IF NOT EXISTS tour_steps (
      order_index INTEGER PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      node_ids    TEXT
    );
  `);
}
