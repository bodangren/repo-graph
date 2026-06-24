import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { updateFiles } from "./update";
import { createSchema } from "./schema";

describe("updateFiles", () => {
  let db: Database;
  let project: Project;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    project = new Project({
      tsConfigFilePath: "./graphing-tools/fixtures/sample-project/tsconfig.json",
    });
  });

  afterEach(() => {
    db.close();
  });

  it("deletes and re-inserts nodes for changed files", () => {
    const filePath = project.getSourceFiles()[0].getFilePath();

    // Pre-populate with old data
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES ('old', 'file', 'old.ts', '${filePath}')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES ('old', 'x', 'contains', 'forward')`);

    const stats = updateFiles(db, project, [filePath]);

    expect(stats.filesUpdated).toBe(1);
    expect(stats.nodesDeleted).toBe(1);
    expect(stats.nodesInserted).toBeGreaterThan(0);
    expect(stats.edgesDeleted).toBe(1);
    expect(stats.edgesInserted).toBeGreaterThan(0);

    // Verify old node is gone
    const oldNode = db.query("SELECT * FROM nodes WHERE id = 'old'").get();
    expect(oldNode).toBeNull();
  }, 15000);

  it("handles placeholder nodes shared across files", () => {
    const filePath = project.getSourceFiles()[0].getFilePath();

    // Pre-populate with a placeholder node (filePath="") that would be
    // recreated by scanning this file — e.g. an unresolved hook reference.
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES ('function:*:useState', 'function', 'useState', '')`);

    const stats = updateFiles(db, project, [filePath]);

    expect(stats.filesUpdated).toBe(1);
    expect(stats.nodesInserted).toBeGreaterThan(0);

    // Placeholder should still exist
    const placeholder = db.query("SELECT * FROM nodes WHERE id = 'function:*:useState'").get();
    expect(placeholder).not.toBeNull();
  }, 15000);

  it("handles relative paths when DB stores absolute paths", () => {
    const filePath = project.getSourceFiles()[0].getFilePath();
    const relativePath = filePath.replace(process.cwd() + "/", "");

    // Pre-populate with a node using the absolute path
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES ('old', 'file', 'old.ts', '${filePath}')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES ('old', 'x', 'contains', 'forward')`);

    // Pass a relative path — this should resolve to the same absolute path in the DB
    const stats = updateFiles(db, project, [relativePath]);

    expect(stats.filesUpdated).toBe(1);
    expect(stats.nodesDeleted).toBe(1);
    expect(stats.nodesInserted).toBeGreaterThan(0);
    expect(stats.edgesDeleted).toBe(1);
    expect(stats.edgesInserted).toBeGreaterThan(0);

    // Verify old node is gone
    const oldNode = db.query("SELECT * FROM nodes WHERE id = 'old'").get();
    expect(oldNode).toBeNull();
  }, 15000);
});

// ── Phase 2 Red — Incremental update behavior (runUpdate) ───────────────────

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("runUpdate — incremental update behavior", () => {
  let db: import("bun:sqlite").Database;
  let project: import("ts-morph").Project;
  let tmpDir: string;
  let tmpFile: string;
  let warnings: string[];
  let origWarn: typeof console.warn;

  beforeEach(async () => {
    db = new (await import("bun:sqlite")).Database(":memory:");
    (await import("./schema")).createSchema(db);
    project = new (await import("ts-morph")).Project({
      tsConfigFilePath: "./graphing-tools/fixtures/sample-project/tsconfig.json",
    });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "runUpdate-"));
    tmpFile = path.join(tmpDir, "test-file.ts");
    fs.writeFileSync(tmpFile, "export const x = 1;\n");
    warnings = [];
    origWarn = console.warn;
    console.warn = (msg: unknown) => { warnings.push(String(msg)); };
  });

  afterEach(() => {
    console.warn = origWarn;
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // U1: runUpdate with a single file updates the commit_sha in metadata
  it("U1: runUpdate with a single file updates the commit_sha in metadata", async () => {
    const { runUpdate } = await import("./update");
    const result = await runUpdate(db, project, [tmpFile], { commitSha: "abc1234" });

    expect(result).toBeDefined();
    expect(typeof result.mode).toBe("string");

    const { getMetadata } = await import("./meta");
    const meta = getMetadata(db);
    expect(meta).toBeDefined();
    expect(meta!.commitSha).toBe("abc1234");
  }, 15000);

  // U2: runUpdate with an empty file list triggers a full-scan fallback
  it("U2: runUpdate with an empty file list triggers a full-scan fallback", async () => {
    const { runUpdate } = await import("./update");
    const result = await runUpdate(db, project, [], {});

    expect(result).toBeDefined();
    expect(result.mode).toBe("full-rescan");

    const nodeCount = (db.prepare("SELECT COUNT(*) AS c FROM nodes").get() as { c: number }).c;
    expect(nodeCount).toBeGreaterThan(0);
  }, 15000);

  // U3: runUpdate with a deleted file path removes all nodes and dependent edges
  it("U3: runUpdate with a deleted file removes all nodes for that path", async () => {
    const absTmp = path.resolve(tmpFile);

    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:${absTmp}', 'file', 'test-file.ts', '${absTmp}'),
      ('function:${absTmp}:x', 'function', 'x', '${absTmp}')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES
      ('file:${absTmp}', 'function:${absTmp}:x', 'contains', 'forward')`);

    // Delete the file from disk
    fs.unlinkSync(tmpFile);

    const { runUpdate } = await import("./update");
    const result = await runUpdate(db, project, [tmpFile], { commitSha: "def5678" });

    expect(result.filesDeleted).toBeGreaterThanOrEqual(1);

    const remaining = db.prepare("SELECT * FROM nodes WHERE file_path = ?").all(absTmp);
    expect(remaining).toEqual([]);

    const edgesLeft = db.prepare(
      "SELECT COUNT(*) AS c FROM edges WHERE source = ? OR target = ?"
    ).get("file:" + absTmp, "file:" + absTmp) as { c: number };
    expect(edgesLeft.c).toBe(0);
  }, 15000);

  // U4: runUpdate with a renamed file path (old + new) is treated as remove-old + add-new
  it("U4: runUpdate with renamed file path treats as remove-old + add-new", async () => {
    const oldPath = path.join(tmpDir, "old-name.ts");
    const newPath = tmpFile;

    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:${oldPath}', 'file', 'old-name.ts', '${oldPath}'),
      ('function:${oldPath}:x', 'function', 'x', '${oldPath}')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES
      ('file:${oldPath}', 'function:${oldPath}:x', 'contains', 'forward')`);

    const { runUpdate } = await import("./update");
    const result = await runUpdate(db, project, [oldPath, newPath], { commitSha: "ghi9012" });

    expect(result.filesDeleted).toBeGreaterThanOrEqual(1);
    expect(result.filesUpdated).toBeGreaterThanOrEqual(1);

    const oldNodes = db.prepare("SELECT * FROM nodes WHERE file_path = ?").all(oldPath);
    expect(oldNodes).toEqual([]);

    const newNodes = db.prepare("SELECT * FROM nodes WHERE file_path = ?").all(path.resolve(newPath));
    expect(newNodes.length).toBeGreaterThan(0);
  }, 15000);

  // U5: runUpdate writes commit_sha to metadata after success
  it("U5: runUpdate writes commit_sha to metadata after success", async () => {
    const { runUpdate } = await import("./update");
    await runUpdate(db, project, [tmpFile], { commitSha: "sha-deadbeef" });

    const { getMetadata } = await import("./meta");
    const meta = getMetadata(db);
    expect(meta).toBeDefined();
    expect(typeof meta!.commitSha).toBe("string");
    expect(meta!.commitSha!.length).toBeGreaterThan(0);
    expect(meta!.commitSha).toBe("sha-deadbeef");
  }, 15000);

  // U6: runUpdate detects schema-version mismatch and falls back to full scan
  it("U6: runUpdate detects schema-version mismatch and falls back to full scan", async () => {
    const { setMetadata } = await import("./meta");
    setMetadata(db, { schemaVersion: "v0-bogus", commitSha: null });

    const { runUpdate } = await import("./update");
    const result = await runUpdate(db, project, [tmpFile], {
      commitSha: "test123",
      currentVersion: "v1",
    });

    expect(result.mode).toBe("full-rescan");
    expect(result.conflict).toBe(true);

    const divergedWarning = warnings.find((w) => w.includes("Graph state diverged"));
    expect(divergedWarning).toBeDefined();
  }, 15000);

  // U7: runUpdate detects a missing meta table and falls back to full scan
  it("U7: runUpdate detects missing meta table and falls back to full scan", async () => {
    db.exec("DROP TABLE meta");

    const { runUpdate } = await import("./update");
    const result = await runUpdate(db, project, [tmpFile], {
      commitSha: "test456",
      currentVersion: "v1",
    });

    expect(result.mode).toBe("full-rescan");
    expect(result.conflict).toBe(true);

    const divergedWarning = warnings.find((w) => w.includes("Graph state diverged"));
    expect(divergedWarning).toBeDefined();
  }, 15000);

  // U8: runUpdate on-disk fallback re-creates the DB when conflict is triggered
  it("U8: runUpdate on-disk fallback re-creates DB when conflict is triggered", async () => {
    db.close();
    const dbPath = path.join(tmpDir, "test-graph.db");

    const { Database } = await import("bun:sqlite");
    const { createSchema } = await import("./schema");
    const { setMetadata } = await import("./meta");

    let diskDb = new Database(dbPath);
    createSchema(diskDb);
    setMetadata(diskDb, { schemaVersion: "v0-bogus", commitSha: null });
    diskDb.close();

    const mtimeBefore = fs.statSync(dbPath).mtimeMs;

    const { runUpdate } = await import("./update");
    const result = await runUpdate(dbPath, project, [tmpFile], {
      commitSha: "on-disk-test",
      currentVersion: "v1",
    });

    expect(result.mode).toBe("full-rescan");
    expect(result.conflict).toBe(true);

    const divergedWarning = warnings.find((w) => w.includes("Graph state diverged"));
    expect(divergedWarning).toBeDefined();

    const mtimeAfter = fs.statSync(dbPath).mtimeMs;
    expect(mtimeAfter).toBeGreaterThanOrEqual(mtimeBefore);

    const { getMetadata } = await import("./meta");
    const newDb = new Database(dbPath);
    const meta = getMetadata(newDb);
    expect(meta).toBeDefined();
    expect(meta!.schemaVersion).toBe("v1");
    newDb.close();
  }, 15000);
});
