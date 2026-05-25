import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { resolveNode } from "./resolve";

describe("resolveNode", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('file:/src/a.ts', 'file', 'a.ts', '/src/a.ts'),
      ('function:/src/a.ts:foo', 'function', 'foo', '/src/a.ts'),
      ('function:/src/b.ts:foo', 'function', 'foo', '/src/b.ts'),
      ('class:/src/a.ts:Bar', 'class', 'Bar', '/src/a.ts')`);
  });

  afterEach(() => {
    db.close();
  });

  it("resolves by exact ID", () => {
    const result = resolveNode(db, "class:/src/a.ts:Bar");
    expect(result.kind).toBe("single");
    if (result.kind === "single") {
      expect(result.node.name).toBe("Bar");
    }
  });

  it("resolves by exact name when unique", () => {
    const result = resolveNode(db, "Bar");
    expect(result.kind).toBe("single");
    if (result.kind === "single") {
      expect(result.node.type).toBe("class");
    }
  });

  it("returns ambiguous when multiple nodes share a name", () => {
    const result = resolveNode(db, "foo");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.matches.length).toBe(2);
    }
  });

  it("resolves by partial match when unique", () => {
    const result = resolveNode(db, "Ba");
    expect(result.kind).toBe("single");
    if (result.kind === "single") {
      expect(result.node.name).toBe("Bar");
    }
  });

  it("returns none for no match", () => {
    const result = resolveNode(db, "zzz");
    expect(result.kind).toBe("none");
  });

  it("resolves single node with underscore in name via partial match", () => {
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('function:/src/a.ts:parse_url', 'function', 'parse_url', '/src/a.ts')`);
    const result = resolveNode(db, "parse_url");
    expect(result.kind).toBe("single");
    if (result.kind === "single") {
      expect(result.node.name).toBe("parse_url");
    }
  });

  it("resolves single node with percent in name via partial match", () => {
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('function:/src/a.ts:100%handler', 'function', '100%handler', '/src/a.ts')`);
    const result = resolveNode(db, "100%handler");
    expect(result.kind).toBe("single");
    if (result.kind === "single") {
      expect(result.node.name).toBe("100%handler");
    }
  });

  it("returns ambiguous for partial match when multiple nodes match", () => {
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('function:/src/a.ts:foobar', 'function', 'foobar', '/src/a.ts'),
      ('function:/src/b.ts:foobaz', 'function', 'foobaz', '/src/b.ts')`);
    const result = resolveNode(db, "fooba");
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.matches.length).toBe(2);
    }
  });
});
