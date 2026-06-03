import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { loadConfig, applyCustomEdges } from "./config";
import type { GraphNode, CustomEdgeDef } from "./contract";

const TMP_DIR = join(import.meta.dir, "__tmp_config_test");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns null when config file does not exist", () => {
    const result = loadConfig(TMP_DIR);
    expect(result).toBeNull();
  });

  it("parses valid config with customEdges", () => {
    writeFileSync(join(TMP_DIR, "build-graph.config.json"), JSON.stringify({
      customEdges: [
        {
          type: "validates_with",
          description: "Route validates against schema",
          sourceType: "route",
          targetType: "schema",
          pattern: {},
        },
      ],
    }));

    const config = loadConfig(TMP_DIR);
    expect(config).not.toBeNull();
    expect(config!.customEdges).toHaveLength(1);
    expect(config!.customEdges![0].type).toBe("validates_with");
    expect(config!.customEdges![0].sourceType).toBe("route");
    expect(config!.customEdges![0].targetType).toBe("schema");
  });

  it("uses explicit configPath over auto-discovery", () => {
    const customPath = join(TMP_DIR, "my-config.json");
    writeFileSync(customPath, JSON.stringify({
      customEdges: [
        { type: "custom_edge", sourceType: "function", targetType: "class", pattern: {} },
      ],
    }));

    const config = loadConfig(TMP_DIR, customPath);
    expect(config).not.toBeNull();
    expect(config!.customEdges![0].type).toBe("custom_edge");
  });

  it("throws on malformed JSON", () => {
    writeFileSync(join(TMP_DIR, "build-graph.config.json"), "{ invalid json }");

    expect(() => loadConfig(TMP_DIR)).toThrow("Malformed config file");
  });

  it("warns and skips entries with missing type", () => {
    writeFileSync(join(TMP_DIR, "build-graph.config.json"), JSON.stringify({
      customEdges: [
        { sourceType: "route", targetType: "schema", pattern: {} },
        { type: "valid_edge", sourceType: "function", targetType: "class", pattern: {} },
      ],
    }));

    const config = loadConfig(TMP_DIR);
    expect(config).not.toBeNull();
    expect(config!.customEdges).toHaveLength(1);
    expect(config!.customEdges![0].type).toBe("valid_edge");
  });

  it("warns and skips entries with invalid sourceType", () => {
    writeFileSync(join(TMP_DIR, "build-graph.config.json"), JSON.stringify({
      customEdges: [
        { type: "bad_edge", sourceType: "not_a_real_type", targetType: "schema", pattern: {} },
        { type: "good_edge", sourceType: "function", targetType: "class", pattern: {} },
      ],
    }));

    const config = loadConfig(TMP_DIR);
    expect(config).not.toBeNull();
    expect(config!.customEdges).toHaveLength(1);
    expect(config!.customEdges![0].type).toBe("good_edge");
  });

  it("returns empty config when customEdges is not an array", () => {
    writeFileSync(join(TMP_DIR, "build-graph.config.json"), JSON.stringify({
      customEdges: "not an array",
    }));

    const config = loadConfig(TMP_DIR);
    expect(config).not.toBeNull();
    expect(config!.customEdges).toBeUndefined();
  });
});

describe("applyCustomEdges", () => {
  const makeNodes = (): GraphNode[] => [
    { id: "route:/app/api/r.ts:GET:/api/test", type: "route", name: "GET /api/test", filePath: "/app/api/r.ts" },
    { id: "schema:/app/api/r.ts:bodySchema", type: "schema", name: "bodySchema", filePath: "/app/api/r.ts" },
    { id: "schema:/app/schema.ts:users", type: "schema", name: "users", filePath: "/app/schema.ts" },
    { id: "function:/app/utils.ts:helper", type: "function", name: "helper", filePath: "/app/utils.ts" },
    { id: "class:/app/utils.ts:Helper", type: "class", name: "Helper", filePath: "/app/utils.ts" },
  ];

  it("creates same-file edges by default (scope: same-file)", () => {
    const nodes = makeNodes();
    const defs: CustomEdgeDef[] = [
      { type: "validates_with", sourceType: "route", targetType: "schema", pattern: {} },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe("validates_with");
    expect(edges[0].source).toBe("route:/app/api/r.ts:GET:/api/test");
    expect(edges[0].target).toBe("schema:/app/api/r.ts:bodySchema");
  });

  it("creates all edges when scope is 'all'", () => {
    const nodes = makeNodes();
    const defs: CustomEdgeDef[] = [
      { type: "validates_with", sourceType: "route", targetType: "schema", pattern: {}, scope: "all" },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(2); // route × both schemas
  });

  it("creates imported edges when scope is 'imported'", () => {
    const nodes = makeNodes();
    const importEdges: GraphEdge[] = [
      { source: "file:/app/api/r.ts", target: "file:/app/schema.ts", type: "imports", direction: "forward" },
    ];
    const defs: CustomEdgeDef[] = [
      { type: "validates_with", sourceType: "route", targetType: "schema", pattern: {}, scope: "imported" },
    ];

    const edges = applyCustomEdges(nodes, defs, importEdges);
    // same-file schema + imported schema = 2
    expect(edges).toHaveLength(2);
    expect(edges.some((e) => e.target === "schema:/app/api/r.ts:bodySchema")).toBe(true);
    expect(edges.some((e) => e.target === "schema:/app/schema.ts:users")).toBe(true);
  });

  it("filters targets by targetName pattern", () => {
    const nodes = makeNodes();
    const defs: CustomEdgeDef[] = [
      { type: "uses_model", sourceType: "function", targetType: "class", pattern: { targetName: "Helper" } },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe("class:/app/utils.ts:Helper");
  });

  it("produces no edges when no nodes match", () => {
    const nodes = makeNodes();
    const defs: CustomEdgeDef[] = [
      { type: "no_match", sourceType: "interface", targetType: "variable", pattern: {} },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(0);
  });
});
