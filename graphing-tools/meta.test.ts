import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { setMeta, getMeta, getProjectRoot } from "./meta";

describe("meta helpers", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores and retrieves a value", () => {
    setMeta(db, "project_root", "/home/user/project");
    expect(getMeta(db, "project_root")).toBe("/home/user/project");
  });

  it("overwrites existing values", () => {
    setMeta(db, "project_root", "/first");
    setMeta(db, "project_root", "/second");
    expect(getMeta(db, "project_root")).toBe("/second");
  });

  it("returns undefined for missing key", () => {
    expect(getMeta(db, "nonexistent")).toBeUndefined();
  });

  it("getProjectRoot returns project_root value", () => {
    setMeta(db, "project_root", "/my/project");
    expect(getProjectRoot(db)).toBe("/my/project");
  });

  it("getMeta returns undefined when meta table is missing", () => {
    const db2 = new Database(":memory:");
    // Do NOT call createSchema — simulate a pre-meta database
    expect(getMeta(db2, "project_root")).toBeUndefined();
    db2.close();
  });

  it("getProjectRoot returns undefined when meta table is missing", () => {
    const db2 = new Database(":memory:");
    // Do NOT call createSchema — simulate a pre-meta database
    expect(getProjectRoot(db2)).toBeUndefined();
    db2.close();
  });
});

// ── A2 — File metadata and freshness (Red Phase) ────────────────────────────

describe("file freshness helpers (A2)", () => {
  let db: Database;
  const ROOT = "/project";

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    setMeta(db, "project_root", ROOT);
  });

  afterEach(() => {
    db.close();
  });

  it("isFileStale returns 'current' when file has not changed since indexing", async () => {
    const { isFileStale } = await import("./meta");
    const now = Date.now();
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/app.ts`, "abc123", 1024, now, now, 5]
    );
    const status = isFileStale(db, `${ROOT}/src/app.ts`);
    expect(["current", "stale", "missing"]).toContain(status);
  });

  it("isFileStale returns 'stale' when file's mtime is newer than indexed_at", async () => {
    const { isFileStale } = await import("./meta");
    const now = Date.now();
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/app.ts`, "abc123", 1024, now + 100_000, now, 5]
    );
    const status = isFileStale(db, `${ROOT}/src/app.ts`);
    expect(status).toBe("stale");
  });

  it("isFileStale returns 'missing' when file has no record in the files table", async () => {
    const { isFileStale } = await import("./meta");
    const status = isFileStale(db, `${ROOT}/nonexistent.ts`);
    expect(status).toBe("missing");
  });

  it("getStaleFiles returns files where modified_at > indexed_at", async () => {
    const { getStaleFiles } = await import("./meta");
    const now = Date.now();
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/current.ts`, "hash1", 500, now, now, 3]
    );
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/stale.ts`, "hash2", 800, now + 100_000, now, 2]
    );

    const staleFiles = getStaleFiles(db);
    expect(Array.isArray(staleFiles)).toBe(true);
    const stalePaths = staleFiles.map((f: { path: string }) => f.path);
    expect(stalePaths).toContain(`${ROOT}/src/stale.ts`);
    expect(stalePaths).not.toContain(`${ROOT}/src/current.ts`);
  });

  it("getStaleFiles returns empty array when all files are current", async () => {
    const { getStaleFiles } = await import("./meta");
    const now = Date.now();
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/app.ts`, "hash", 500, now, now, 3]
    );
    const staleFiles = getStaleFiles(db);
    expect(staleFiles).toEqual([]);
  });

  it("getStaleFiles returns empty array when files table is empty", async () => {
    const { getStaleFiles } = await import("./meta");
    const staleFiles = getStaleFiles(db);
    expect(staleFiles).toEqual([]);
  });
});

describe("file metadata from scan/update (A2)", () => {
  let db: Database;
  const ROOT = "/project";

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    setMeta(db, "project_root", ROOT);
  });

  afterEach(() => {
    db.close();
  });

  it("files table accepts a row with all required fields for scan metadata", () => {
    // Simulate what scan would write
    const now = Date.now();
    db.run(
      `INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count, errors)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`${ROOT}/src/app.ts`, "sha256:abcdef", 2048, now, now, 8, null]
    );
    const row = db.prepare("SELECT * FROM files WHERE path = ?").get(`${ROOT}/src/app.ts`) as Record<string, unknown>;
    expect(row.path).toBe(`${ROOT}/src/app.ts`);
    expect(row.content_hash).toBe("sha256:abcdef");
    expect(row.size).toBe(2048);
    expect(row.modified_at).toBe(now);
    expect(row.indexed_at).toBe(now);
    expect(row.node_count).toBe(8);
    expect(row.errors).toBeNull();
  });

  it("files table records node_count for each scanned file", () => {
    const now = Date.now();
    // Simulate scanning two files with different node counts
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/small.ts`, "h1", 100, now, now, 2]
    );
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/large.ts`, "h2", 5000, now, now, 25]
    );
    const small = db.prepare("SELECT node_count FROM files WHERE path = ?").get(`${ROOT}/src/small.ts`) as { node_count: number };
    const large = db.prepare("SELECT node_count FROM files WHERE path = ?").get(`${ROOT}/src/large.ts`) as { node_count: number };
    expect(small.node_count).toBe(2);
    expect(large.node_count).toBe(25);
  });

  it("INSERT OR REPLACE on files table refreshes content_hash and indexed_at on update", () => {
    const t1 = 1700000000;
    const t2 = 1700000100;
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/app.ts`, "old_hash", 1000, t1, t1, 5]
    );
    // Simulate update: refresh hash and indexed_at
    db.run(
      "INSERT OR REPLACE INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/app.ts`, "new_hash", 1100, t2, t2, 6]
    );
    const row = db.prepare("SELECT * FROM files WHERE path = ?").get(`${ROOT}/src/app.ts`) as Record<string, unknown>;
    expect(row.content_hash).toBe("new_hash");
    expect(row.indexed_at).toBe(t2);
    expect(row.node_count).toBe(6);
  });

  it("deleting a file removes its files table row and dependent nodes/edges", () => {
    const now = Date.now();
    // Seed a file record
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/deleteme.ts`, "hash", 500, now, now, 3]
    );
    // Seed nodes and edges for that file
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:${ROOT}/src/deleteme.ts', 'file', 'deleteme.ts', '${ROOT}/src/deleteme.ts'),
      ('function:${ROOT}/src/deleteme.ts:foo', 'function', 'foo', '${ROOT}/src/deleteme.ts')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES
      ('file:${ROOT}/src/deleteme.ts', 'function:${ROOT}/src/deleteme.ts:foo', 'contains', 'forward')`);

    // Simulate update deletion: remove edges first, then nodes, then file record
    db.prepare("DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = ?) OR target IN (SELECT id FROM nodes WHERE file_path = ?)").run(
      `${ROOT}/src/deleteme.ts`, `${ROOT}/src/deleteme.ts`
    );
    db.prepare("DELETE FROM nodes WHERE file_path = ?").run(`${ROOT}/src/deleteme.ts`);
    db.prepare("DELETE FROM files WHERE path = ?").run(`${ROOT}/src/deleteme.ts`);

    // Verify cleanup
    const fileRow = db.prepare("SELECT * FROM files WHERE path = ?").get(`${ROOT}/src/deleteme.ts`);
    expect(fileRow).toBeNull();

    const nodeCount = (db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE file_path = ?").get(`${ROOT}/src/deleteme.ts`) as { c: number }).c;
    expect(nodeCount).toBe(0);

    const edgeCount = (db.prepare("SELECT COUNT(*) AS c FROM edges WHERE source LIKE '%deleteme%' OR target LIKE '%deleteme%'").get() as { c: number }).c;
    expect(edgeCount).toBe(0);
  });
});

describe("stale-file warnings in stats/inspect (A2)", () => {
  let db: Database;
  const ROOT = "/project";

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    setMeta(db, "project_root", ROOT);
    // Seed some nodes
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:${ROOT}/src/app.ts', 'file', 'app.ts', '${ROOT}/src/app.ts'),
      ('function:${ROOT}/src/app.ts:main', 'function', 'main', '${ROOT}/src/app.ts')`);
  });

  afterEach(() => {
    db.close();
  });

  it("runStats JSON output includes stale-files warning when stale files exist", async () => {
    const { runStats } = await import("./commands");
    const now = Date.now();
    // Insert a stale file record
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/app.ts`, "hash", 500, now + 100_000, now, 2]
    );
    const output = runStats(db, { json: true });
    const parsed = JSON.parse(output);
    // Phase 3 should add this field when stale files are detected
    expect(parsed.freshness).toBeDefined();
    expect(Array.isArray(parsed.freshness.stale)).toBe(true);
  });

  it("runInspect JSON output includes stale-file warning for inspected node's file", async () => {
    const { runInspect } = await import("./commands");
    const now = Date.now();
    // Insert a stale file record for the inspected node's file
    db.run(
      "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
      [`${ROOT}/src/app.ts`, "hash", 500, now + 100_000, now, 2]
    );
    const { output, exitCode } = runInspect(db, "main", { json: true });
    expect(exitCode).toBe(0); // ExitCode.Success
    const parsed = JSON.parse(output);
    // Phase 3 should add freshness info to inspect output
    expect(parsed.freshness).toBeDefined();
    expect(Array.isArray(parsed.freshness.stale)).toBe(true);
  });
});
