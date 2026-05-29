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

  describe("duplicate nodes", () => {
    it("reports nodes with same name, type, and file_path", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/a.ts:foo', 'function', 'foo', '/project/src/a.ts'),
        ('function:/project/src/a.ts:foo2', 'function', 'foo', '/project/src/a.ts')`);

      const { output, exitCode } = runAudit(db);
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("duplicate_nodes");
    });

    it("does not report unique nodes", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/a.ts:foo', 'function', 'foo', '/project/src/a.ts'),
        ('function:/project/src/a.ts:bar', 'function', 'bar', '/project/src/a.ts')`);

      const { output, exitCode } = runAudit(db);
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("duplicate_nodes");
    });
  });
});
