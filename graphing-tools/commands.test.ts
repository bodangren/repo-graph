import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { setMeta } from "./meta";
import { runDeps, runCallers, runPath, runStats, runFiles, runInspect } from "./commands";
import { ExitCode } from "./contract";

describe("convenience commands", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
    setMeta(db, "project_root", "/project");

    // Seed nodes
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts'),
      ('file:/project/src/b.ts', 'file', 'b.ts', '/project/src/b.ts'),
      ('file:/project/src/c.ts', 'file', 'c.ts', '/project/src/c.ts'),
      ('function:/project/src/a.ts:foo', 'function', 'foo', '/project/src/a.ts'),
      ('function:/project/src/a.ts:bar', 'function', 'bar', '/project/src/a.ts'),
      ('function:/project/src/b.ts:baz', 'function', 'baz', '/project/src/b.ts'),
      ('class:/project/src/a.ts:Widget', 'class', 'Widget', '/project/src/a.ts'),
      ('interface:/project/src/a.ts:IWidget', 'interface', 'IWidget', '/project/src/a.ts')`);

    // Seed edges
    db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
      ('file:/project/src/a.ts', 'function:/project/src/a.ts:foo', 'contains', 'forward', 1),
      ('file:/project/src/a.ts', 'function:/project/src/a.ts:bar', 'contains', 'forward', 1),
      ('file:/project/src/b.ts', 'function:/project/src/b.ts:baz', 'contains', 'forward', 1),
      ('file:/project/src/b.ts', 'file:/project/src/a.ts', 'imports', 'forward', 1),
      ('function:/project/src/b.ts:baz', 'function:/project/src/a.ts:foo', 'depends_on', 'forward', 1),
      ('class:/project/src/a.ts:Widget', 'interface:/project/src/a.ts:IWidget', 'implements', 'forward', 1),
      ('file:/project/src/c.ts', 'file:/project/src/b.ts', 'imports', 'forward', 1)`);
  });

  afterEach(() => {
    db.close();
  });

  describe("runDeps with package filters (S4)", () => {
    beforeEach(() => {
      // Add package_id to existing seed nodes
      db.exec(`UPDATE nodes SET package_id = 'frontend' WHERE file_path LIKE '%/src/a.ts'`);
      db.exec(`UPDATE nodes SET package_id = 'backend' WHERE file_path LIKE '%/src/b.ts'`);
      db.exec(`UPDATE nodes SET package_id = 'frontend' WHERE file_path LIKE '%/src/c.ts'`);
    });

    it("filters deps by fromPackage", () => {
      const { output, exitCode } = runDeps(db, "foo", false, { fromPackage: "backend" });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
      expect(output).not.toContain("a.ts");
    });

    it("filters deps by toPackage", () => {
      // upstream deps: toPackage filters the target side (foo), which is in frontend
      const { output, exitCode } = runDeps(db, "foo", false, { toPackage: "frontend" });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
    });

    it("excludes deps when toPackage does not match target", () => {
      const { output, exitCode } = runDeps(db, "foo", false, { toPackage: "backend" });
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toBe("(no results)");
    });

    it("combines fromPackage and toPackage", () => {
      // fromPackage=backend filters source (baz), toPackage=frontend filters target (foo)
      const { output, exitCode } = runDeps(db, "foo", false, { fromPackage: "backend", toPackage: "frontend" });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
    });

    it("returns JSON with package filters", () => {
      const { output, exitCode } = runDeps(db, "foo", false, { json: true, fromPackage: "backend" });
      expect(exitCode).toBe(ExitCode.Success);
      const parsed = JSON.parse(output);
      expect(parsed.results.length).toBe(1);
      expect(parsed.results[0].name).toBe("baz");
    });
  });

  describe("runCallers with package filters (S4)", () => {
    beforeEach(() => {
      db.exec(`UPDATE nodes SET package_id = 'frontend' WHERE file_path LIKE '%/src/a.ts'`);
      db.exec(`UPDATE nodes SET package_id = 'backend' WHERE file_path LIKE '%/src/b.ts'`);
    });

    it("filters callers by fromPackage", () => {
      const { output, exitCode } = runCallers(db, "foo", { fromPackage: "backend" });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
    });

    it("excludes callers from other packages", () => {
      // Insert another caller in frontend
      db.exec(`INSERT INTO nodes (id, type, name, file_path, package_id) VALUES
        ('function:/project/src/c.ts:fooCaller', 'function', 'fooCaller', '/project/src/c.ts', 'frontend')`);
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('function:/project/src/c.ts:fooCaller', 'function:/project/src/a.ts:foo', 'calls', 'forward', 1)`);
      const { output, exitCode } = runCallers(db, "foo", { fromPackage: "backend" });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
      expect(output).not.toContain("fooCaller");
    });
  });

  describe("runStats package breakdown (S4)", () => {
    beforeEach(() => {
      db.exec(`UPDATE nodes SET package_id = 'frontend' WHERE file_path LIKE '%/src/a.ts'`);
      db.exec(`UPDATE nodes SET package_id = 'backend' WHERE file_path LIKE '%/src/b.ts'`);
      db.exec(`UPDATE nodes SET package_id = 'frontend' WHERE file_path LIKE '%/src/c.ts'`);
    });

    it("shows package breakdown in text output", () => {
      const output = runStats(db);
      expect(output).toContain("frontend");
      expect(output).toContain("backend");
    });

    it("shows package breakdown in JSON output", () => {
      const output = runStats(db, { json: true });
      const parsed = JSON.parse(output);
      expect(parsed.packages).toBeDefined();
      expect(typeof parsed.packages.frontend).toBe("number");
      expect(typeof parsed.packages.backend).toBe("number");
    });
  });

  describe("runDeps", () => {
    it("finds upstream dependents (default)", () => {
      const { output, exitCode } = runDeps(db, "foo", false);
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
      expect(output).toContain("depends_on");
    });

    it("finds downstream dependencies with --downstream", () => {
      const { output, exitCode } = runDeps(db, "baz", true);
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("foo");
    });

    it("shows relative paths", () => {
      const { output, exitCode } = runDeps(db, "foo", false);
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("./src/b.ts");
      expect(output).not.toContain("/project/src");
    });

    it("returns ambiguous for colliding names", () => {
      // Insert a second 'bar' in another file
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/c.ts:bar', 'function', 'bar', '/project/src/c.ts')`);
      const { output, exitCode } = runDeps(db, "bar", false);
      expect(exitCode).toBe(ExitCode.Ambiguous);
      expect(output).toBe("");
    });

    it("returns not found for unmatched name", () => {
      const { output, exitCode } = runDeps(db, "zzz", false);
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toBe("(no matches)");
    });

    it("returns JSON output when json: true", () => {
      const { output, exitCode } = runDeps(db, "foo", false, { json: true });
      expect(exitCode).toBe(ExitCode.Success);
      const parsed = JSON.parse(output);
      expect(parsed.node).toBeDefined();
      expect(Array.isArray(parsed.results)).toBe(true);
      expect(parsed.results.length).toBeGreaterThan(0);
    });

    it("returns JSON not-found when json: true", () => {
      const { output, exitCode } = runDeps(db, "zzz", false, { json: true });
      expect(exitCode).toBe(ExitCode.NotFound);
      const parsed = JSON.parse(output);
      expect(parsed.results).toEqual([]);
    });

    it("respects limit", () => {
      const { output, exitCode } = runDeps(db, "foo", false, { limit: 1 });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("… and 1 more");
    });

    it("returns all results when limit is 0", () => {
      const { output, exitCode } = runDeps(db, "foo", false, { limit: 0 });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toContain("… and");
    });

    it("respects depth for multi-hop traversal", () => {
      // Seed a chain: a.ts → b.ts → c.ts
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/d.ts', 'file', 'd.ts', '/project/src/d.ts')`);
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('file:/project/src/c.ts', 'file:/project/src/d.ts', 'imports', 'forward', 1)`);
      // upstream from a.ts (who depends on a.ts): b.ts (depth 1), c.ts (depth 2)
      const { output, exitCode } = runDeps(db, "a.ts", false, { depth: 2 });
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("b.ts");
      expect(output).toContain("c.ts");
    });
  });

  describe("runCallers", () => {
    it("finds function callers", () => {
      const { output, exitCode } = runCallers(db, "foo");
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
    });

    it("returns not found for unmatched name", () => {
      const { output, exitCode } = runCallers(db, "zzz");
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toBe("(no matches)");
    });

    it("does not list the owning file as a caller", () => {
      const { output, exitCode } = runCallers(db, "foo");
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("baz");
      expect(output).not.toContain("contains");
    });

    it("returns JSON output when json: true", () => {
      const { output, exitCode } = runCallers(db, "foo", { json: true });
      expect(exitCode).toBe(ExitCode.Success);
      const parsed = JSON.parse(output);
      expect(parsed.node).toBeDefined();
      expect(Array.isArray(parsed.results)).toBe(true);
    });
  });

  describe("runPath", () => {
    it("traces a path between two nodes", () => {
      const { output, exitCode } = runPath(db, "c.ts", "a.ts");
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("file:c.ts");
      expect(output).toContain("file:b.ts");
      expect(output).toContain("file:a.ts");
    });

    it("returns no path found when disconnected", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/d.ts', 'file', 'd.ts', '/project/src/d.ts')`);
      const { output, exitCode } = runPath(db, "d.ts", "a.ts");
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toBe("(no path found)");
    });

    it("returns ambiguous for colliding names", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/c.ts:foo', 'function', 'foo', '/project/src/c.ts')`);
      const { output, exitCode } = runPath(db, "foo", "a.ts");
      expect(exitCode).toBe(ExitCode.Ambiguous);
    });

    it("returns ambiguous for source when target is missing", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/c.ts:parse', 'function', 'parse', '/project/src/c.ts'),
        ('function:/project/src/a.ts:parse', 'function', 'parse', '/project/src/a.ts')`);
      const { output, exitCode } = runPath(db, "parse", "missingNode");
      expect(exitCode).toBe(ExitCode.Ambiguous);
      expect(output).toBe("");
    });

    it("finds path when intermediate node IDs share a prefix", () => {
      // Seed nodes with prefix collision: get vs getter
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/a.ts:get', 'function', 'get', '/project/src/a.ts'),
        ('function:/project/src/a.ts:getter', 'function', 'getter', '/project/src/a.ts')`);
      db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('function:/project/src/a.ts:get', 'function:/project/src/a.ts:getter', 'calls', 'forward', 1)`);
      const { output, exitCode } = runPath(db, "get", "getter");
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).not.toBe("(no path found)");
      expect(output).toContain("get");
      expect(output).toContain("getter");
    });

    it("returns JSON path when json: true", () => {
      const { output, exitCode } = runPath(db, "c.ts", "a.ts", { json: true });
      expect(exitCode).toBe(ExitCode.Success);
      const parsed = JSON.parse(output);
      expect(parsed.found).toBe(true);
      expect(parsed.hops).toBeGreaterThan(0);
      expect(Array.isArray(parsed.path)).toBe(true);
    });

    it("returns JSON not-found when json: true", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/d.ts', 'file', 'd.ts', '/project/src/d.ts')`);
      const { output, exitCode } = runPath(db, "d.ts", "a.ts", { json: true });
      expect(exitCode).toBe(ExitCode.NotFound);
      const parsed = JSON.parse(output);
      expect(parsed.found).toBe(false);
    });
  });

  describe("runStats", () => {
    it("includes totals", () => {
      const output = runStats(db);
      expect(output).toContain("Total nodes:");
      expect(output).toContain("Total edges:");
      expect(output).toContain("Total files:");
    });

    it("includes nodes by type chart", () => {
      const output = runStats(db);
      expect(output).toContain("Nodes by type:");
      expect(output).toContain("file");
      expect(output).toContain("function");
    });

    it("shows relative paths", () => {
      const output = runStats(db);
      expect(output).toContain("./src/");
      expect(output).not.toContain("/project/src/");
    });

    it("returns JSON when json: true", () => {
      const output = runStats(db, { json: true });
      const parsed = JSON.parse(output);
      expect(typeof parsed.totals).toBe("object");
      expect(Array.isArray(parsed.by_type)).toBe(true);
    });
  });

  describe("runFiles", () => {
    it("lists all files with counts", () => {
      const output = runFiles(db);
      expect(output).toContain("a.ts");
      expect(output).toContain("b.ts");
      expect(output).toContain("c.ts");
    });

    it("filters by pattern", () => {
      const output = runFiles(db, "a.ts");
      expect(output).toContain("a.ts");
      expect(output).not.toContain("b.ts");
    });

    it("shows correct entity counts", () => {
      const output = runFiles(db);
      // a.ts has foo, bar, Widget, IWidget = 4 entities
      expect(output).toContain("a.ts");
    });

    it("returns correct counts for multiple file types", () => {
      // Seed additional entities in b.ts for richer assertions
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('class:/project/src/b.ts:Helper', 'class', 'Helper', '/project/src/b.ts'),
        ('interface:/project/src/b.ts:IHelper', 'interface', 'IHelper', '/project/src/b.ts'),
        ('type_alias:/project/src/b.ts:T', 'type_alias', 'T', '/project/src/b.ts')`);
      const output = runFiles(db);
      expect(output).toContain("a.ts");
      expect(output).toContain("b.ts");
      // b.ts now has baz, Helper, IHelper, T = 4 non-file entities
      // a.ts has foo, bar, Widget, IWidget = 4 non-file entities
    });

    it("returns JSON array when json: true", () => {
      const output = runFiles(db, undefined, { json: true });
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0].name).toBeDefined();
    });

    it("respects limit on files", () => {
      const output = runFiles(db, undefined, { limit: 2 });
      expect(output).toContain("… and 1 more");
    });
  });

  describe("runInspect", () => {
    it("returns text output for existing node", () => {
      const { output, exitCode } = runInspect(db, "foo");
      expect(exitCode).toBe(ExitCode.Success);
      expect(output).toContain("foo");
      expect(output).toContain("Outgoing edges");
      expect(output).toContain("Incoming edges");
    });

    it("returns JSON for existing node when json: true", () => {
      const { output, exitCode } = runInspect(db, "foo", { json: true });
      expect(exitCode).toBe(ExitCode.Success);
      const parsed = JSON.parse(output);
      expect(parsed.node).toBeDefined();
      expect(parsed.node.name).toBe("foo");
      expect(Array.isArray(parsed.outgoing)).toBe(true);
      expect(Array.isArray(parsed.incoming)).toBe(true);
    });

    it("returns not found for missing node", () => {
      const { output, exitCode } = runInspect(db, "zzz");
      expect(exitCode).toBe(ExitCode.NotFound);
      expect(output).toBe("(no matches)");
    });

    it("returns ambiguous for colliding names", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/c.ts:foo', 'function', 'foo', '/project/src/c.ts')`);
      const { output, exitCode } = runInspect(db, "foo");
      expect(exitCode).toBe(ExitCode.Ambiguous);
      expect(output).toBe("");
    });
  });

  describe("no-meta DB fallback", () => {
    it("runDeps works on DB without meta table", () => {
      const db2 = new Database(":memory:");
      db2.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT, name TEXT, file_path TEXT, package_id TEXT);
                  CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, type TEXT, direction TEXT, weight REAL);`);
      db2.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts'),
        ('function:/project/src/a.ts:foo', 'function', 'foo', '/project/src/a.ts')`);
      db2.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('function:/project/src/a.ts:foo', 'file:/project/src/a.ts', 'depends_on', 'forward', 1)`);
      const { output, exitCode } = runDeps(db2, "foo", true);
      expect(exitCode).toBe(ExitCode.Success);
      // Should use absolute paths since no project_root in meta
      expect(output).toContain("/project/src/a.ts");
      db2.close();
    });

    it("runStats works on DB without meta table", () => {
      const db2 = new Database(":memory:");
      db2.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT, name TEXT, file_path TEXT, package_id TEXT);
                  CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, type TEXT, direction TEXT, weight REAL);`);
      db2.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts')`);
      const output = runStats(db2);
      expect(output).toContain("Total nodes:");
      db2.close();
    });
  });
});
