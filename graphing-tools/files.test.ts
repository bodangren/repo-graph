import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createSchema } from "./schema";
import { setMeta } from "./meta";
import { hashFile, recordFileMetadata, deleteFileData, fileExists } from "./files";

describe("files helpers (A2)", () => {
  let db: Database;
  let tempDir: string;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    tempDir = mkdtempSync(join(tmpdir(), "repo-graph-files-"));
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("hashFile returns sha256-prefixed hex for a readable file", () => {
    const filePath = join(tempDir, "sample.ts");
    writeFileSync(filePath, "export const x = 1;", "utf-8");
    const result = hashFile(filePath);
    expect(result).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("hashFile returns null for a missing file", () => {
    const result = hashFile(join(tempDir, "missing.ts"));
    expect(result).toBeNull();
  });

  it("recordFileMetadata writes a files row with hash, size, mtime and node count", () => {
    const filePath = join(tempDir, "app.ts");
    writeFileSync(filePath, "export function foo() {}", "utf-8");

    const meta = recordFileMetadata(db, tempDir, filePath, null);
    expect(meta).not.toBeNull();

    const row = db.prepare("SELECT * FROM files WHERE path = ?").get(filePath) as Record<string, unknown>;
    expect(row.path).toBe(filePath);
    expect(row.content_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(row.size).toBeGreaterThan(0);
    expect(typeof row.modified_at).toBe("number");
    expect(typeof row.indexed_at).toBe("number");
    expect(row.node_count).toBe(0);
  });

  it("recordFileMetadata reports the actual node count for a file", () => {
    const filePath = join(tempDir, "app.ts");
    writeFileSync(filePath, "export function foo() {}", "utf-8");
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:${filePath}', 'file', 'app.ts', '${filePath}'),
      ('function:${filePath}:foo', 'function', 'foo', '${filePath}')`);

    const meta = recordFileMetadata(db, tempDir, filePath, null);
    expect(meta?.node_count).toBe(2);
  });

  it("recordFileMetadata returns null when the file is missing", () => {
    const result = recordFileMetadata(db, tempDir, join(tempDir, "missing.ts"), null);
    expect(result).toBeNull();
  });

  it("deleteFileData removes edges, nodes, and the files row for a path", () => {
    const filePath = join(tempDir, "deleteme.ts");
    writeFileSync(filePath, "export function foo() {}", "utf-8");
    db.exec(`INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count)
      VALUES (?, 'h', 1, 1, 1, 1)`, [filePath]);
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:${filePath}', 'file', 'deleteme.ts', '${filePath}'),
      ('function:${filePath}:foo', 'function', 'foo', '${filePath}')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES
      ('file:${filePath}', 'function:${filePath}:foo', 'contains', 'forward')`);

    const result = deleteFileData(db, filePath);
    expect(result.nodesDeleted).toBe(2);
    expect(result.edgesDeleted).toBe(1);
    expect(result.filesDeleted).toBe(1);

    const fileRow = db.prepare("SELECT 1 FROM files WHERE path = ?").get(filePath);
    expect(fileRow).toBeNull();
    const nodeRow = db.prepare("SELECT 1 FROM nodes WHERE file_path = ?").get(filePath);
    expect(nodeRow).toBeNull();
  });

  it("fileExists returns true for existing files and false for missing files", () => {
    const existing = join(tempDir, "exists.ts");
    writeFileSync(existing, "", "utf-8");
    expect(fileExists(existing)).toBe(true);
    expect(fileExists(join(tempDir, "missing.ts"))).toBe(false);
  });
});
