import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { ingestNodes } from "./ingest";

describe("ingestNodes", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts a single node", () => {
    const nodes = [
      {
        id: "file:src/auth.ts",
        type: "file",
        name: "auth.ts",
        filePath: "src/auth.ts",
        summary: "Authentication module",
        tags: ["api-handler", "auth"],
        complexity: "moderate",
        languageNotes: "TypeScript",
      },
    ];

    ingestNodes(db, nodes);

    const row = db.query("SELECT * FROM nodes WHERE id = ?").get("file:src/auth.ts") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("auth.ts");
    expect(row.file_path).toBe("src/auth.ts");
    expect(row.tags).toBe('["api-handler","auth"]');
  });

  it("inserts multiple nodes in a batch", () => {
    const nodes = [
      { id: "n1", type: "function", name: "fn1", filePath: "a.ts", summary: "", tags: [], complexity: "simple", languageNotes: "" },
      { id: "n2", type: "function", name: "fn2", filePath: "b.ts", summary: "", tags: [], complexity: "simple", languageNotes: "" },
    ];

    ingestNodes(db, nodes);

    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM nodes").get();
    expect(count?.c).toBe(2);
  });

  it("rolls back on invalid node", () => {
    const nodes = [
      { id: "n1", type: "function", name: "fn1", filePath: "a.ts", summary: "", tags: [], complexity: "simple", languageNotes: "" },
      { id: "n1", type: "function", name: "fn2", filePath: "b.ts", summary: "", tags: [], complexity: "simple", languageNotes: "" }, // duplicate PK
    ];

    expect(() => ingestNodes(db, nodes)).toThrow();

    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM nodes").get();
    expect(count?.c).toBe(0);
  });
});
