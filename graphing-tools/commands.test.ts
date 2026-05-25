import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { setMeta } from "./meta";
import { runDeps, runCallers, runPath, runStats, runFiles } from "./commands";

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

  describe("runDeps", () => {
    it("finds upstream dependents (default)", () => {
      const { output, exitCode } = runDeps(db, "foo", false);
      expect(exitCode).toBe(0);
      expect(output).toContain("baz");
      expect(output).toContain("depends_on");
    });

    it("finds downstream dependencies with --downstream", () => {
      const { output, exitCode } = runDeps(db, "baz", true);
      expect(exitCode).toBe(0);
      expect(output).toContain("foo");
    });

    it("shows relative paths", () => {
      const { output, exitCode } = runDeps(db, "foo", false);
      expect(exitCode).toBe(0);
      expect(output).toContain("./src/b.ts");
      expect(output).not.toContain("/project/src");
    });

    it("returns ambiguous for colliding names", () => {
      // Insert a second 'bar' in another file
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/c.ts:bar', 'function', 'bar', '/project/src/c.ts')`);
      const { output, exitCode } = runDeps(db, "bar", false);
      expect(exitCode).toBe(2);
      expect(output).toBe("");
    });

    it("returns no results for unmatched name", () => {
      const { output, exitCode } = runDeps(db, "zzz", false);
      expect(exitCode).toBe(0);
      expect(output).toBe("(no matches)");
    });
  });

  describe("runCallers", () => {
    it("finds function callers", () => {
      const { output, exitCode } = runCallers(db, "foo");
      expect(exitCode).toBe(0);
      expect(output).toContain("baz");
    });

    it("returns no results for unmatched name", () => {
      const { output, exitCode } = runCallers(db, "zzz");
      expect(exitCode).toBe(0);
      expect(output).toBe("(no matches)");
    });

    it("does not list the owning file as a caller", () => {
      const { output, exitCode } = runCallers(db, "foo");
      expect(exitCode).toBe(0);
      expect(output).toContain("baz");
      expect(output).not.toContain("contains");
    });
  });

  describe("runPath", () => {
    it("traces a path between two nodes", () => {
      const { output, exitCode } = runPath(db, "c.ts", "a.ts");
      expect(exitCode).toBe(0);
      expect(output).toContain("file:c.ts");
      expect(output).toContain("file:b.ts");
      expect(output).toContain("file:a.ts");
    });

    it("returns no path found when disconnected", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/d.ts', 'file', 'd.ts', '/project/src/d.ts')`);
      const { output, exitCode } = runPath(db, "d.ts", "a.ts");
      expect(exitCode).toBe(0);
      expect(output).toBe("(no path found)");
    });

    it("returns ambiguous for colliding names", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/c.ts:foo', 'function', 'foo', '/project/src/c.ts')`);
      const { output, exitCode } = runPath(db, "foo", "a.ts");
      expect(exitCode).toBe(2);
    });

    it("returns ambiguous for source when target is missing", () => {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('function:/project/src/c.ts:parse', 'function', 'parse', '/project/src/c.ts')`);
      const { output, exitCode } = runPath(db, "parse", "missingNode");
      expect(exitCode).toBe(2);
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
      expect(exitCode).toBe(0);
      expect(output).not.toBe("(no path found)");
      expect(output).toContain("get");
      expect(output).toContain("getter");
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
  });

  describe("no-meta DB fallback", () => {
    it("runDeps works on DB without meta table", () => {
      const db2 = new Database(":memory:");
      db2.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT, name TEXT, file_path TEXT);
                  CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, type TEXT, direction TEXT, weight REAL);`);
      db2.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts'),
        ('function:/project/src/a.ts:foo', 'function', 'foo', '/project/src/a.ts')`);
      db2.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
        ('function:/project/src/a.ts:foo', 'file:/project/src/a.ts', 'depends_on', 'forward', 1)`);
      const { output, exitCode } = runDeps(db2, "foo", true);
      expect(exitCode).toBe(0);
      // Should use absolute paths since no project_root in meta
      expect(output).toContain("/project/src/a.ts");
      db2.close();
    });

    it("runStats works on DB without meta table", () => {
      const db2 = new Database(":memory:");
      db2.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, type TEXT, name TEXT, file_path TEXT);
                  CREATE TABLE edges (id INTEGER PRIMARY KEY, source TEXT, target TEXT, type TEXT, direction TEXT, weight REAL);`);
      db2.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
        ('file:/project/src/a.ts', 'file', 'a.ts', '/project/src/a.ts')`);
      const output = runStats(db2);
      expect(output).toContain("Total nodes:");
      db2.close();
    });
  });
});
