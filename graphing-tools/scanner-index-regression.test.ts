import { describe, expect, it } from "bun:test";
import { Project } from "ts-morph";
import type { GraphEdge, GraphNode } from "./contract";
import { scanProject } from "./scanner";

function projectWith(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, source] of Object.entries(files)) {
    project.createSourceFile(path, source);
  }
  return project;
}

function functionNode(nodes: GraphNode[], name: string): GraphNode {
  const node = nodes.find((candidate) => candidate.type === "function" && candidate.name === name);
  if (!node) throw new Error(`Missing function node: ${name}`);
  return node;
}

function resolvedCallsFrom(edges: GraphEdge[], source: string): GraphEdge[] {
  return edges.filter((edge) =>
    edge.type === "calls" &&
    edge.source === source &&
    JSON.parse(edge.metadata ?? "{}").resolution === "resolved"
  );
}

describe("scanner symbol-index characterization", () => {
  it("preserves duplicate declaration names and lexical call tie-breaking", () => {
    const project = projectWith({
      "/overloads.ts": [
        "export function parse(value: string) { return value; }",
        "export function parse(value: number) { return value; }",
        "export function parse(value: string | number) { return String(value); }",
        "export function run() { return parse(1); }",
      ].join("\n"),
    });

    const { nodes, edges } = scanProject(project);
    const overloadNames = nodes
      .filter((node) => node.type === "function" && node.filePath === "/overloads.ts")
      .map((node) => node.name);

    expect(overloadNames).toEqual(["parse", "parse@2", "parse@3", "run"]);

    const run = functionNode(nodes, "run");
    expect(resolvedCallsFrom(edges, run.id)).toContainEqual({
      source: run.id,
      target: "function:/overloads.ts:parse",
      type: "calls",
      direction: "forward",
      weight: 1,
      metadata: JSON.stringify({ resolution: "resolved", expression: "parse" }),
    });
    expect(edges.filter((edge) => edge.type === "contains" && edge.source === "file:/overloads.ts"))
      .toHaveLength(4);
  });

  it("preserves named-import alias resolution", () => {
    const project = projectWith({
      "/lib.ts": "export function parse(value: number) { return value; }",
      "/app.ts": [
        'import { parse as convert } from "./lib";',
        "export function run() { return convert(1); }",
      ].join("\n"),
    });

    const { nodes, edges } = scanProject(project);
    const run = functionNode(nodes, "run");
    expect(resolvedCallsFrom(edges, run.id)).toContainEqual({
      source: run.id,
      target: "function:/lib.ts:parse",
      type: "calls",
      direction: "forward",
      weight: 1,
      metadata: JSON.stringify({ resolution: "resolved", expression: "convert" }),
    });
  }, 30_000);

  it("preserves unaliased named-import resolution", () => {
    const project = projectWith({
      "/lib.ts": "export function parse(value: number) { return value; }",
      "/app.ts": [
        'import { parse } from "./lib";',
        "export function run() { return parse(1); }",
      ].join("\n"),
    });

    const { nodes, edges } = scanProject(project);
    const run = functionNode(nodes, "run");
    expect(resolvedCallsFrom(edges, run.id)).toContainEqual({
      source: run.id,
      target: "function:/lib.ts:parse",
      type: "calls",
      direction: "forward",
      weight: 1,
      metadata: JSON.stringify({ resolution: "resolved", expression: "parse" }),
    });
  }, 30_000);

  it("preserves anonymous default-import resolution", () => {
    const project = projectWith({
      "/lib.ts": "export default function (value: number) { return value; }",
      "/app.ts": [
        'import convert from "./lib";',
        "export function run() { return convert(1); }",
      ].join("\n"),
    });

    const { nodes, edges } = scanProject(project);
    const run = functionNode(nodes, "run");
    expect(resolvedCallsFrom(edges, run.id)).toContainEqual({
      source: run.id,
      target: "function:/lib.ts:default",
      type: "calls",
      direction: "forward",
      weight: 1,
      metadata: JSON.stringify({ resolution: "resolved", expression: "convert" }),
    });
  }, 30_000);

  it("preserves this-qualified method resolution", () => {
    const project = projectWith({
      "/parser.ts": [
        "export class Parser {",
        "  helper() { return 1; }",
        "  run() { return this.helper(); }",
        "}",
      ].join("\n"),
    });

    const { nodes, edges } = scanProject(project);
    const run = functionNode(nodes, "Parser.run");
    expect(resolvedCallsFrom(edges, run.id)).toContainEqual({
      source: run.id,
      target: "function:/parser.ts:Parser.helper",
      type: "calls",
      direction: "forward",
      weight: 1,
      metadata: JSON.stringify({ resolution: "resolved", expression: "this.helper" }),
    });
  });

  it("preserves class-qualified method resolution", () => {
    const project = projectWith({
      "/parser.ts": [
        "export class Parser {",
        "  static helper() { return 1; }",
        "}",
        "export function run() { return Parser.helper(); }",
      ].join("\n"),
    });

    const { nodes, edges } = scanProject(project);
    const run = functionNode(nodes, "run");
    expect(resolvedCallsFrom(edges, run.id)).toContainEqual({
      source: run.id,
      target: "function:/parser.ts:Parser.helper",
      type: "calls",
      direction: "forward",
      weight: 1,
      metadata: JSON.stringify({ resolution: "resolved", expression: "Parser.helper" }),
    });
  });

  it("preserves unresolved call identity, tags, and metadata", () => {
    const project = projectWith({
      "/dynamic.ts": "export function run() { return dynamicOperation(); }",
    });

    const { nodes, edges } = scanProject(project);
    const run = functionNode(nodes, "run");
    const unresolved = nodes.find((node) =>
      node.id.startsWith("unresolved-call:/dynamic.ts:") &&
      node.name === "dynamicOperation"
    );

    expect(unresolved).toBeDefined();
    expect(unresolved?.filePath).toBe("");
    expect(unresolved?.tags).toEqual(["unresolved", "dynamic"]);
    expect(edges).toContainEqual({
      source: run.id,
      target: unresolved!.id,
      type: "calls",
      direction: "forward",
      weight: 1,
      metadata: JSON.stringify({ resolution: "unresolved", expression: "dynamicOperation" }),
    });
  });

  it("scans a dense many-symbol and many-call fixture deterministically", () => {
    const declarations = Array.from({ length: 750 }, (_, index) =>
      `export function function${index}() { return ${index}; }`
    );
    const calls = Array.from({ length: 750 }, (_, index) => `function${index}()`).join(" + ");
    const project = projectWith({
      "/dense.ts": [...declarations, `export function run() { return ${calls}; }`].join("\n"),
    });

    const start = performance.now();
    const first = scanProject(project);
    const elapsed = performance.now() - start;
    const second = scanProject(project);

    expect(first.nodes).toEqual(second.nodes);
    expect(first.edges).toEqual(second.edges);
    expect(first.nodes.filter((node) => node.type === "function" && node.filePath === "/dense.ts"))
      .toHaveLength(751);
    expect(resolvedCallsFrom(first.edges, functionNode(first.nodes, "run").id)).toHaveLength(750);
    expect(elapsed).toBeLessThan(15_000);
  }, 30_000);
});
