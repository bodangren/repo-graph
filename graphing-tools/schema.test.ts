import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, FTS5_CREATE_SQL, FTS5_INSERT_NODE_SQL, FTS5_DELETE_NODE_SQL, FILES_TABLE_SQL, FILES_INDEX_SQL, EDGE_TRAVERSAL_INDEX_SQL } from "./schema";

describe("createSchema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates the nodes table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'").get();
    expect(result).toBeDefined();
  });

  it("creates the edges table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='edges'").get();
    expect(result).toBeDefined();
  });

  it("creates the layers table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='layers'").get();
    expect(result).toBeDefined();
  });

  it("creates the tour_steps table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tour_steps'").get();
    expect(result).toBeDefined();
  });

  it("creates the meta table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
    expect(result).toBeDefined();
  });

  it("nodes table has correct columns", () => {
    createSchema(db);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(nodes)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("type");
    expect(names).toContain("name");
    expect(names).toContain("file_path");
    expect(names).toContain("summary");
    expect(names).toContain("tags");
    expect(names).toContain("complexity");
    expect(names).toContain("language_notes");
    expect(names).toContain("layer_id");
  });

  it("edges table has correct columns", () => {
    createSchema(db);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(edges)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("source");
    expect(names).toContain("target");
    expect(names).toContain("type");
    expect(names).toContain("direction");
    expect(names).toContain("weight");
    expect(names).toContain("metadata");
  });

  it("nodes.id is a primary key", () => {
    createSchema(db);
    const cols = db.query<{ name: string; pk: number }, []>("PRAGMA table_info(nodes)").all();
    const idCol = cols.find((c) => c.name === "id");
    expect(idCol?.pk).toBe(1);
  });

  it("edges.id is auto-increment primary key", () => {
    createSchema(db);
    const cols = db.query<{ name: string; pk: number }, []>("PRAGMA table_info(edges)").all();
    const idCol = cols.find((c) => c.name === "id");
    expect(idCol?.pk).toBe(1);
  });
});

// ── Files table (A2) ────────────────────────────────────────────────────────

describe("files table", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("is created by createSchema", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='files'").get();
    expect(result).toBeDefined();
  });

  it("has the expected columns", () => {
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(files)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("path");
    expect(names).toContain("content_hash");
    expect(names).toContain("size");
    expect(names).toContain("modified_at");
    expect(names).toContain("indexed_at");
    expect(names).toContain("node_count");
    expect(names).toContain("errors");
  });

  it("path is the primary key", () => {
    const cols = db.query<{ name: string; pk: number }, []>("PRAGMA table_info(files)").all();
    const pathCol = cols.find((c) => c.name === "path");
    expect(pathCol?.pk).toBe(1);
  });

  it("node_count defaults to 0", () => {
    const cols = db.query<{ name: string; dflt_value: string | null }, []>("PRAGMA table_info(files)").all();
    const nodeCountCol = cols.find((c) => c.name === "node_count");
    expect(nodeCountCol?.dflt_value).toBe("0");
  });

  it("accepts a row with all required fields", () => {
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      ["src/app.ts", "abc123", 1024, 1700000000, 1700000001, 5]
    );
    const row = db.query("SELECT * FROM files WHERE path = ?").get("src/app.ts") as Record<string, unknown>;
    expect(row.path).toBe("src/app.ts");
    expect(row.content_hash).toBe("abc123");
    expect(row.size).toBe(1024);
    expect(row.node_count).toBe(5);
  });
});

// ── Files indexes ───────────────────────────────────────────────────────────

describe("files indexes", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates idx_files_path index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_files_path'").get();
    expect(result).toBeDefined();
  });

  it("creates idx_files_modified_at index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_files_modified_at'").get();
    expect(result).toBeDefined();
  });
});

// ── Edge traversal indexes ──────────────────────────────────────────────────

describe("edge traversal indexes", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates idx_edges_source_type index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_edges_source_type'").get();
    expect(result).toBeDefined();
  });

  it("creates idx_edges_target_type index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_edges_target_type'").get();
    expect(result).toBeDefined();
  });

  it("creates idx_edges_type index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_edges_type'").get();
    expect(result).toBeDefined();
  });
});

// ── FTS5 DDL constants ──────────────────────────────────────────────────────

describe("FTS5 DDL constants", () => {
  it("exports FTS5_CREATE_SQL with fts5 virtual table definition", () => {
    expect(FTS5_CREATE_SQL).toBeDefined();
    expect(typeof FTS5_CREATE_SQL).toBe("string");
    expect(FTS5_CREATE_SQL).toContain("CREATE VIRTUAL TABLE");
    expect(FTS5_CREATE_SQL).toContain("nodes_fts");
    expect(FTS5_CREATE_SQL).toContain("fts5");
    expect(FTS5_CREATE_SQL).toContain("content='nodes'");
  });

  it("exports FTS5_INSERT_NODE_SQL for application-level FTS sync", () => {
    expect(FTS5_INSERT_NODE_SQL).toBeDefined();
    expect(typeof FTS5_INSERT_NODE_SQL).toBe("string");
    expect(FTS5_INSERT_NODE_SQL).toContain("INSERT INTO nodes_fts");
    expect(FTS5_INSERT_NODE_SQL).not.toMatch(/CREATE\s+TRIGGER/i);
  });

  it("exports FTS5_DELETE_NODE_SQL for application-level FTS sync", () => {
    expect(FTS5_DELETE_NODE_SQL).toBeDefined();
    expect(typeof FTS5_DELETE_NODE_SQL).toBe("string");
    expect(FTS5_DELETE_NODE_SQL).toContain("'delete'");
    expect(FTS5_DELETE_NODE_SQL).not.toMatch(/CREATE\s+TRIGGER/i);
  });

  it("exports FILES_TABLE_SQL", () => {
    expect(FILES_TABLE_SQL).toBeDefined();
    expect(typeof FILES_TABLE_SQL).toBe("string");
    expect(FILES_TABLE_SQL).toContain("CREATE TABLE IF NOT EXISTS files");
  });

  it("exports FILES_INDEX_SQL", () => {
    expect(FILES_INDEX_SQL).toBeDefined();
    expect(typeof FILES_INDEX_SQL).toBe("string");
    expect(FILES_INDEX_SQL).toContain("idx_files_path");
    expect(FILES_INDEX_SQL).toContain("idx_files_modified_at");
  });

  it("exports EDGE_TRAVERSAL_INDEX_SQL", () => {
    expect(EDGE_TRAVERSAL_INDEX_SQL).toBeDefined();
    expect(typeof EDGE_TRAVERSAL_INDEX_SQL).toBe("string");
    expect(EDGE_TRAVERSAL_INDEX_SQL).toContain("idx_edges_source_type");
    expect(EDGE_TRAVERSAL_INDEX_SQL).toContain("idx_edges_target_type");
    expect(EDGE_TRAVERSAL_INDEX_SQL).toContain("idx_edges_type");
  });
});

// ── FTS5 defensive creation ─────────────────────────────────────────────────

describe("FTS5 defensive creation", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("createSchema does not throw when FTS5 is available", () => {
    expect(() => createSchema(db)).not.toThrow();
  });

  it("createSchema is idempotent (no error on second call)", () => {
    createSchema(db);
    expect(() => createSchema(db)).not.toThrow();
  });

  it("nodes_fts virtual table is created when FTS5 is available", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'").get();
    expect(result).toBeDefined();
  });

  it("FTS5 triggers are intentionally NOT created at schema time (Phase 3 application-level sync)", () => {
    createSchema(db);
    const triggers = db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'nodes_fts_%'").all();
    expect(triggers.length).toBe(0);
  });
});
