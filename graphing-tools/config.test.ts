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
    { id: "schema:/app/schema.ts:users", type: "schema", name: "users", filePath: "/app/schema.ts" },
    { id: "function:/app/utils.ts:helper", type: "function", name: "helper", filePath: "/app/utils.ts" },
    { id: "class:/app/models.ts:User", type: "class", name: "User", filePath: "/app/models.ts" },
  ];

  it("creates edges matching sourceType and targetType", () => {
    const nodes = makeNodes();
    const defs: CustomEdgeDef[] = [
      { type: "validates_with", sourceType: "route", targetType: "schema", pattern: {} },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe("validates_with");
    expect(edges[0].source).toBe("route:/app/api/r.ts:GET:/api/test");
    expect(edges[0].target).toBe("schema:/app/schema.ts:users");
  });

  it("filters targets by targetName pattern", () => {
    const nodes = makeNodes();
    const defs: CustomEdgeDef[] = [
      { type: "uses_model", sourceType: "function", targetType: "class", pattern: { targetName: "User" } },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(1);
    expect(edges[0].target).toBe("class:/app/models.ts:User");
  });

  it("produces no edges when no nodes match", () => {
    const nodes = makeNodes();
    const defs: CustomEdgeDef[] = [
      { type: "no_match", sourceType: "interface", targetType: "variable", pattern: {} },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(0);
  });

  it("creates multiple edges for multiple matching pairs", () => {
    const nodes: GraphNode[] = [
      { id: "route:/a.ts:GET:/a", type: "route", name: "GET /a", filePath: "/a.ts" },
      { id: "route:/b.ts:GET:/b", type: "route", name: "GET /b", filePath: "/b.ts" },
      { id: "schema:/s.ts:x", type: "schema", name: "x", filePath: "/s.ts" },
    ];
    const defs: CustomEdgeDef[] = [
      { type: "validates_with", sourceType: "route", targetType: "schema", pattern: {} },
    ];

    const edges = applyCustomEdges(nodes, defs);
    expect(edges).toHaveLength(2);
  });
});
