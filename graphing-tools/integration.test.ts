import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { buildGraphDb } from "./build-graph-db";

describe("buildGraphDb", () => {
  const inputPath = "/tmp/test-knowledge-graph.json";
  const outputPath = "/tmp/test-graph.db";

  beforeEach(async () => {
    const sample = {
      nodes: [
        { id: "n1", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "", tags: ["core"], complexity: "simple", languageNotes: "" },
        { id: "n2", type: "function", name: "fn", filePath: "src/a.ts", summary: "", tags: [], complexity: "simple", languageNotes: "" },
      ],
      edges: [
        { source: "n1", target: "n2", type: "contains", direction: "forward", weight: 1.0 },
      ],
      layers: [
        { id: "layer:core", name: "Core", description: "", nodeIds: ["n1"] },
      ],
      tour_steps: [
        { orderIndex: 0, title: "Overview", description: "", nodeIds: ["n1"] },
      ],
    };
    await Bun.write(inputPath, JSON.stringify(sample));
  });

  afterEach(() => {
    try { require("fs").unlinkSync(outputPath); } catch { /* ignore */ }
  });

  it("creates a graph.db from knowledge-graph.json", async () => {
    await buildGraphDb(inputPath, outputPath);

    const db = new Database(outputPath);
    const nodeCount = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM nodes").get();
    const edgeCount = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM edges").get();
    const layerCount = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM layers").get();
    const stepCount = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM tour_steps").get();
    const n1 = db.query<{ layer_id: string | null }, []>("SELECT layer_id FROM nodes WHERE id = 'n1'").get();

    expect(nodeCount?.c).toBe(2);
    expect(edgeCount?.c).toBe(1);
    expect(layerCount?.c).toBe(1);
    expect(stepCount?.c).toBe(1);
    expect(n1?.layer_id).toBe("layer:core");

    db.close();
  });

  it("throws on invalid JSON", async () => {
    await Bun.write(inputPath, "not json");
    await expect(buildGraphDb(inputPath, outputPath)).rejects.toThrow("Invalid JSON");
  });

  it("throws when nodes field is missing", async () => {
    await Bun.write(inputPath, JSON.stringify({ edges: [], layers: [], tour_steps: [] }));
    await expect(buildGraphDb(inputPath, outputPath)).rejects.toThrow("Missing required field");
  });
});
