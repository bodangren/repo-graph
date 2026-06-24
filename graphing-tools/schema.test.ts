import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, FTS5_CREATE_SQL, FTS5_INSERT_NODE_SQL, FTS5_DELETE_NODE_SQL, FILES_TABLE_SQL, FILES_INDEX_SQL, EDGE_TRAVERSAL_INDEX_SQL, SCHEMA_VERSION, GRAPH_META_KEY } from "./schema";
import { getMetadata, setMetadata } from "./meta";

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
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'").get() as { name: string } | undefined;
    expect(result?.name).toBe("nodes");
  });

  it("creates the edges table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='edges'").get() as { name: string } | undefined;
    expect(result?.name).toBe("edges");
  });

  it("creates the layers table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='layers'").get() as { name: string } | undefined;
    expect(result?.name).toBe("layers");
  });

  it("creates the tour_steps table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tour_steps'").get() as { name: string } | undefined;
    expect(result?.name).toBe("tour_steps");
  });

  it("creates the meta table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get() as { name: string } | undefined;
    expect(result?.name).toBe("meta");
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
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='files'").get() as { name: string } | undefined;
    expect(result?.name).toBe("files");
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
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_files_path'").get() as { name: string } | undefined;
    expect(result?.name).toBe("idx_files_path");
  });

  it("creates idx_files_modified_at index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_files_modified_at'").get() as { name: string } | undefined;
    expect(result?.name).toBe("idx_files_modified_at");
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
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_edges_source_type'").get() as { name: string } | undefined;
    expect(result?.name).toBe("idx_edges_source_type");
  });

  it("creates idx_edges_target_type index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_edges_target_type'").get() as { name: string } | undefined;
    expect(result?.name).toBe("idx_edges_target_type");
  });

  it("creates idx_edges_type index", () => {
    const result = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_edges_type'").get() as { name: string } | undefined;
    expect(result?.name).toBe("idx_edges_type");
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
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes_fts'").get() as { name: string } | undefined;
    expect(result?.name).toBe("nodes_fts");
  });

  it("FTS5 triggers are intentionally NOT created at schema time (Phase 3 application-level sync)", () => {
    createSchema(db);
    const triggers = db.query("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'nodes_fts_%'").all();
    expect(triggers.length).toBe(0);
  });
});

// ── SCHEMA_VERSION constant ─────────────────────────────────────────────────

describe("SCHEMA_VERSION", () => {
  it("is exported and is a non-empty string", () => {
    expect(typeof SCHEMA_VERSION).toBe("string");
    expect(SCHEMA_VERSION.length).toBeGreaterThan(0);
  });

  it("follows semver-like format", () => {
    expect(SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ── GRAPH_META_KEY constant ─────────────────────────────────────────────────

describe("GRAPH_META_KEY", () => {
 it("is exported and equals 'graph'", () => {
    expect(GRAPH_META_KEY).toBe("graph");
  });
});

// ── meta table schema_version and commit_sha columns ────────────────────────

describe("meta table schema_version and commit_sha columns", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("createSchema adds schema_version column to meta table", () => {
    createSchema(db);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(meta)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("schema_version");
  });

  it("createSchema adds commit_sha column to meta table", () => {
    createSchema(db);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(meta)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("commit_sha");
  });

  it("column addition is idempotent (no error on second createSchema call)", () => {
    createSchema(db);
    expect(() => createSchema(db)).not.toThrow();
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(meta)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("schema_version");
    expect(names).toContain("commit_sha");
  });
});

// ── getMetadata / setMetadata operations ─────────────────────────────────────

describe("getMetadata", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns a GraphMetadata object when metadata exists", () => {
    // Seed structured metadata via the raw meta table
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      GRAPH_META_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, commitSha: "abc1234" })
    );
    const result = getMetadata(db);
    expect(result).toBeDefined();
    expect(result!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result!.commitSha).toBe("abc1234");
  });

  it("returns undefined when no metadata row exists", () => {
    const result = getMetadata(db);
    expect(result).toBeUndefined();
  });
});

describe("setMetadata", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("writes structured metadata to the meta table", () => {
    setMetadata(db, { schemaVersion: SCHEMA_VERSION, commitSha: "def5678" });
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(GRAPH_META_KEY) as { value: string } | undefined;
    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.value);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.commitSha).toBe("def5678");
  });

  it("merges partial updates with existing metadata", () => {
    setMetadata(db, { schemaVersion: SCHEMA_VERSION, commitSha: "aaa" });
    setMetadata(db, { commitSha: "bbb" });
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(GRAPH_META_KEY) as { value: string };
    const parsed = JSON.parse(row.value);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.commitSha).toBe("bbb");
  });
});
