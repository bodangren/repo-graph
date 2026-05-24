import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { ingestNodes, ingestEdges, ingestLayers, ingestTourSteps, resolveLayerIds } from "./ingest";

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

describe("ingestEdges", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts a single edge", () => {
    const edges = [{ source: "n1", target: "n2", type: "calls", direction: "forward", weight: 0.8 }];
    ingestEdges(db, edges);

    const row = db.query("SELECT * FROM edges WHERE source = ? AND target = ?").get("n1", "n2") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.type).toBe("calls");
    expect(row.direction).toBe("forward");
    expect(row.weight).toBe(0.8);
  });

  it("inserts multiple edges in a batch", () => {
    const edges = [
      { source: "n1", target: "n2", type: "calls", direction: "forward", weight: 0.5 },
      { source: "n2", target: "n3", type: "imports", direction: "forward", weight: 0.5 },
    ];
    ingestEdges(db, edges);

    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM edges").get();
    expect(count?.c).toBe(2);
  });

  it("rolls back on invalid edge", () => {
    const edges = [
      { source: "n1", target: "n2", type: "calls", direction: "forward", weight: 0.5 },
      { source: "n1", target: null, type: "calls", direction: "forward", weight: 0.5 } as unknown as Parameters<typeof ingestEdges>[1][0],
    ];

    expect(() => ingestEdges(db, edges)).toThrow();

    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM edges").get();
    expect(count?.c).toBe(0);
  });
});

describe("ingestLayers", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts layers with serialized nodeIds", () => {
    const layers = [
      { id: "layer:data-access", name: "Data Access", description: "DB layer", nodeIds: ["n1", "n2"] },
    ];
    ingestLayers(db, layers);

    const row = db.query("SELECT * FROM layers WHERE id = ?").get("layer:data-access") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("Data Access");
    expect(row.node_ids).toBe('["n1","n2"]');
  });
});

describe("ingestTourSteps", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
  });

  afterEach(() => {
    db.close();
  });

  it("inserts tour steps with serialized nodeIds", () => {
    const steps = [
      { orderIndex: 0, title: "Intro", description: "First step", nodeIds: ["n1"] },
    ];
    ingestTourSteps(db, steps);

    const row = db.query("SELECT * FROM tour_steps WHERE order_index = ?").get(0) as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.title).toBe("Intro");
    expect(row.node_ids).toBe('["n1"]');
  });
});

describe("resolveLayerIds", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
  });

  afterEach(() => {
    db.close();
  });

  it("resolves layer_id from layers.node_ids", () => {
    ingestNodes(db, [
      { id: "n1", type: "function", name: "fn1", filePath: "a.ts", summary: "", tags: [], complexity: "simple", languageNotes: "" },
      { id: "n2", type: "function", name: "fn2", filePath: "b.ts", summary: "", tags: [], complexity: "simple", languageNotes: "" },
    ]);
    ingestLayers(db, [
      { id: "layer:core", name: "Core", description: "", nodeIds: ["n1"] },
    ]);

    resolveLayerIds(db);

    const r1 = db.query<{ layer_id: string | null }, []>("SELECT layer_id FROM nodes WHERE id = 'n1'").get();
    const r2 = db.query<{ layer_id: string | null }, []>("SELECT layer_id FROM nodes WHERE id = 'n2'").get();
    expect(r1?.layer_id).toBe("layer:core");
    expect(r2?.layer_id).toBeNull();
  });
});
