import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { scanProject } from "./scanner";
import { runQuery } from "./query";
import { searchNodes } from "./search";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";

describe("build-graph end-to-end", () => {
  let db: Database;
  let project: Project;

  beforeAll(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);

    project = new Project({
      tsConfigFilePath: "./graphing-tools/fixtures/sample-project/tsconfig.json",
    });

    const { nodes, edges } = scanProject(project);

    const insertNode = db.prepare(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertEdge = db.prepare(`INSERT INTO edges (source, target, type, direction, weight)
      VALUES (?, ?, ?, ?, ?)`);

    db.transaction(() => {
      for (const n of nodes) {
        insertNode.run(n.id, n.type, n.name, n.filePath, n.lineStart ?? null, n.lineEnd ?? null, n.summary ?? null, n.tags ? JSON.stringify(n.tags) : null);
      }
      for (const e of edges) {
        insertEdge.run(e.source, e.target, e.type, e.direction, e.weight ?? 0.5);
      }
    })();
  });

  afterAll(() => {
    db.close();
  });

  it("scans and inserts all fixture nodes", () => {
    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM nodes").get();
    expect(count?.c).toBeGreaterThan(10); // file + funcs + classes + interfaces + types
  });

  it("scans and inserts all fixture edges", () => {
    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM edges").get();
    expect(count?.c).toBeGreaterThan(5);
  });

  it("query returns correct node data", () => {
    const result = runQuery(db, "SELECT name, type FROM nodes WHERE type = 'class' ORDER BY name");
    expect(result.rows.map((r) => r[0])).toContain("Admin");
    expect(result.rows.map((r) => r[0])).toContain("User");
  });

  it("search finds nodes by keyword", () => {
    const results = searchNodes(db, "User");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.name === "User")).toBe(true);
  });

  it("import edges connect auth.ts to utils.ts", () => {
    const result = runQuery(db, `
      SELECT e.source, e.target
      FROM edges e
      JOIN nodes src ON e.source = src.id
      WHERE src.name = 'auth.ts' AND e.type = 'imports'
    `);
    expect(result.rows.length).toBeGreaterThan(0);
  });
});
