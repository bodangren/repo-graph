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

    it("reports edges with both source and target missing", () => {
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('file:/project/src/a.ts', 'file:/project/src/b.ts', 'imports', 'forward', 1)`);

      const { output, exitCode } = runAudit(db);
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("orphan_edges");
      expect(output).toContain("both");
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

    it("does not report arrow-function variables that still exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_arrow_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const myArrow = () => 1;\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('function:${tmpDir}/a.ts:myArrow', 'function', 'myArrow', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("stale_symbols");
    });

    it("reports interface nodes that no longer exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_stale_iface_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('interface:${tmpDir}/a.ts:OldIface', 'interface', 'OldIface', '${tmpDir}/a.ts', 1, 5)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("OldIface");
    });

    it("does not report interface nodes that still exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_fresh_iface_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export interface MyIface { x: number }\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('interface:${tmpDir}/a.ts:MyIface', 'interface', 'MyIface', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("stale_symbols");
    });

    it("reports all symbols in a missing file as stale", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_missing_file_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function foo() {}\nexport class Bar {}\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('function:${tmpDir}/a.ts:foo', 'function', 'foo', '${tmpDir}/a.ts', 1, 1),
        ('class:${tmpDir}/a.ts:Bar', 'class', 'Bar', '${tmpDir}/a.ts', 2, 2)`);

      fs.rmSync(tmpDir + "/a.ts");

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("foo");
      expect(output).toContain("Bar");
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

  describe("param nodes", () => {
    it("does not report param nodes that still exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_param_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function foo(arg: number) { return arg; }\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('param:${tmpDir}/a.ts:foo:arg', 'param', 'arg', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("stale_symbols");
    });

    it("reports param nodes that no longer exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_stale_param_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function foo() { return 1; }\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('param:${tmpDir}/a.ts:foo:arg', 'param', 'arg', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("stale_symbols");
      expect(output).toContain("arg");
    });
  });

  describe("schema nodes", () => {
    it("does not report schema nodes from defineTable that still exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_schema_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const users = defineTable({ name: v.string() });\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('schema:${tmpDir}/a.ts:users', 'schema', 'users', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("stale_symbols");
    });

    it("does not report schema nodes from exported const object literals that still exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_schema_const_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const config = { host: 'localhost', port: 3000 };\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('schema:${tmpDir}/a.ts:config', 'schema', 'config', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("stale_symbols");
    });

    it("reports schema nodes that no longer exist", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_stale_schema_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('schema:${tmpDir}/a.ts:OldSchema', 'schema', 'OldSchema', '${tmpDir}/a.ts', 1, 5)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("OldSchema");
    });
  });

  describe("unaudited node types", () => {
    it("reports field and route nodes as unaudited rather than silently ignoring them", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_unaudited_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('field:${tmpDir}/a.ts:Schema.field', 'field', 'Schema.field', '${tmpDir}/a.ts', 1, 1),
        ('route:${tmpDir}/a.ts:GET:/api', 'route', 'GET /api', '${tmpDir}/a.ts', 2, 2)`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("unaudited_symbols");
      expect(output).toContain("field");
      expect(output).toContain("route");
    });

    it("includes unaudited symbols in JSON output", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_unaudited_json_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export const x = 1;");

      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('field:${tmpDir}/a.ts:Schema.field', 'field', 'Schema.field', '${tmpDir}/a.ts', 1, 1)`);

      const { output, exitCode } = runAudit(db, { json: true });
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      const parsed = JSON.parse(output);
      expect(parsed.unauditedSymbols.length).toBe(1);
      expect(parsed.unauditedSymbols[0].type).toBe("field");
    });
  });

  describe("full audit integration", () => {
    it("reports all issue types in a single run", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_full_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function foo() {}\nexport class Bar {}\n");
      fs.writeFileSync(tmpDir + "/b.ts", "export const x = 1;\n");

      // Missing file
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:${tmpDir}/missing.ts', 'file', 'missing.ts', '${tmpDir}/missing.ts')`);

      // Stale symbol
      db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end) VALUES
        ('function:${tmpDir}/a.ts:oldFunc', 'function', 'oldFunc', '${tmpDir}/a.ts', 1, 5)`);

      // Orphan edge
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('file:${tmpDir}/missing.ts', 'file:${tmpDir}/a.ts', 'imports', 'forward', 1)`);

      // Duplicate node
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:${tmpDir}/a.ts:foo', 'function', 'foo', '${tmpDir}/a.ts'),
        ('function:${tmpDir}/a.ts:foo2', 'function', 'foo', '${tmpDir}/a.ts')`);

      const { output, exitCode } = runAudit(db);
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toContain("missing_files");
      expect(output).toContain("stale_symbols");
      expect(output).toContain("orphan_edges");
      expect(output).toContain("duplicate_nodes");
    });

    it("returns JSON with all issue types", () => {
      const fs = require("fs");
      const tmpDir = "/tmp/audit_test_json_" + Date.now();
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpDir + "/a.ts", "export function foo() {}\n");

      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:${tmpDir}/missing.ts', 'file', 'missing.ts', '${tmpDir}/missing.ts')`);

      const { output, exitCode } = runAudit(db, { json: true });
      fs.rmSync(tmpDir, { recursive: true });

      expect(exitCode).toBe(ExitCode.NotFound);
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed.missingFiles)).toBe(true);
      expect(Array.isArray(parsed.staleSymbols)).toBe(true);
      expect(Array.isArray(parsed.orphanEdges)).toBe(true);
      expect(Array.isArray(parsed.duplicateNodes)).toBe(true);
      expect(Array.isArray(parsed.unauditedSymbols)).toBe(true);
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
