import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { runQuery, formatTable, formatJson } from "./query";
import { createSchema } from "./schema";

describe("runQuery", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('n1', 'file', 'a.ts', '/src/a.ts'),
      ('n2', 'function', 'foo', '/src/a.ts')`);
  });

  afterEach(() => {
    db.close();
  });

  it("executes valid SQL and returns columns + rows", () => {
    const result = runQuery(db, "SELECT id, name FROM nodes WHERE type = 'file'");
    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([["n1", "a.ts"]]);
  });

  it("returns empty result for no matches", () => {
    const result = runQuery(db, "SELECT * FROM nodes WHERE name = 'nonexistent'");
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("handles multiple rows", () => {
    const result = runQuery(db, "SELECT id FROM nodes ORDER BY id");
    expect(result.rows.length).toBe(2);
  });
});

describe("formatTable", () => {
  it("formats results as a table", () => {
    const output = formatTable(
      ["id", "name"],
      [
        ["n1", "a.ts"],
        ["n2", "b.ts"],
      ]
    );
    expect(output).toContain("id | name");
    expect(output).toContain("n1 | a.ts");
    expect(output).toContain("n2 | b.ts");
  });

  it("handles empty results", () => {
    expect(formatTable([], [])).toBe("(no results)");
  });

  it("displays NULL for null values", () => {
    const output = formatTable(["name", "summary"], [["foo", null]]);
    expect(output).toContain("foo");
    expect(output).toContain("NULL");
  });
});

describe("formatJson", () => {
  it("formats results as JSON", () => {
    const output = formatJson(
      ["id", "name"],
      [["n1", "a.ts"]]
    );
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([{ id: "n1", name: "a.ts" }]);
  });
});
