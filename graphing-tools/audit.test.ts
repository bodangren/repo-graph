import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { setMeta } from "./meta";
import { runAudit } from "./audit";
import { ExitCode } from "./contract";

describe("runAudit", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
    setMeta(db, "project_root", "/project");
  });

  afterEach(() => {
    db.close();
  });

  describe("missing files", () => {
    it("reports file nodes whose paths no longer exist", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts'),
        ('file:/project/src/missing.ts', 'file', 'missing.ts', '/project/src/missing.ts')`);

      const { output, exitCode } = runAudit(db);
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("missing.ts");
      expect(output).toContain("missing_files");
    });

    it("returns clean when all files exist (via temp files)", () => {
      const tmpDir = "/tmp/audit_test_" + Date.now();
      const fs = require("fs");
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:${tmpDir}/a.ts', 'file', 'a.ts', '${tmpDir}/a.ts')`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("missing_files");
    });

    it("returns JSON with missing file details", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/missing.ts', 'file', 'missing.ts', '/project/src/missing.ts')`);

      const { output, exitCode } = runAudit(db, { json: true });
      expect(exitCode).toBe(ExitCode.NotFound);
      const parsed = JSON.parse(output);
      expect(parsed.missingFiles.length).toBe(1);
      expect(parsed.missingFiles[0].name).toBe("missing.ts");
    });
  });

  describe("orphan edges", () => {
    it("reports edges with missing source node", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts')`);
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('file:/project/src/b.ts', 'file:/project/src/a.ts', 'imports', 'forward', 1)`);

      const { output, exitCode } = runAudit(db);
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("orphan_edges");
    });

    it("reports edges with missing target node", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts')`);
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('file:/project/src/a.ts', 'file:/project/src/b.ts', 'imports', 'forward', 1)`);

      const { output, exitCode } = runAudit(db);
      expect(exitCode).toBe(ExitCode.NotFound);
    });

    it("does not report valid edges", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_edges_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");
      fs.writeFileSync(tmpDir + "/b.ts", "export const y = 2;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:${tmpDir}/a.ts', 'file', 'a.ts', '${tmpDir}/a.ts'),
        ('file:${tmpDir}/b.ts', 'file', 'b.ts', '${tmpDir}/b.ts')`);
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('file:${tmpDir}/a.ts', 'file:${tmpDir}/b.ts', 'imports', 'forward', 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("orphan_edges");
    });
  });

  describe("stale symbols", () => {
    it("reports function nodes that no longer exist in source", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_stale_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('function:${tmpDir}/a.ts:oldFunc', 'function', 'oldFunc', '${tmpDir}/a.ts', 1, 5)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("stale_symbols");
      expect(output).toContain("oldFunc");
    });

    it("does not report symbols that still exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_fresh_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function existingFunc() { return 1; }\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('function:${tmpDir}/a.ts:existingFunc', 'function', 'existingFunc', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("stale_symbols");
    });

    it("reports class nodes that no longer exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_stale_class_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('class:${tmpDir}/a.ts:OldClass', 'class', 'OldClass', '${tmpDir}/a.ts', 1, 5)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("OldClass");
    });

    it("returns JSON with stale symbol details", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_stale_json_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('function:${tmpDir}/a.ts:oldFunc', 'function', 'oldFunc', '${tmpDir}/a.ts', 1, 5)`);

      const { output, exitCode } = runAudit(db, { json: true });
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      const parsed = JSON.parse(output);
      expect(parsed.staleSymbols.length).toBe(1);
      expect(parsed.staleSymbols[0].name).toBe("oldFunc");
    });
  });

  describe("duplicate nodes", () => {
    it("reports nodes with same name, type, and file_path", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_dup2_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function foo() {}\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:${tmpDir}/a.ts:foo', 'function', 'foo', '${tmpDir}/a.ts'),
        ('function:${tmpDir}/a.ts:foo2', 'function', 'foo', '${tmpDir}/a.ts')`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("duplicate_nodes");
    });

    it("does not report unique nodes", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_dup_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function foo() {}\nexport function bar() {}\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:${tmpDir}/a.ts:foo', 'function', 'foo', '${tmpDir}/a.ts'),
        ('function:${tmpDir}/a.ts:bar', 'function', 'bar', '${tmpDir}/a.ts')`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("duplicate_nodes");
    });
  });
});
