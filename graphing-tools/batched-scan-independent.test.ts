import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Project } from "ts-morph";
import {
  planProjectBatches,
  scanProjectBatches,
} from "./batched-scan";
import { extractProjectGraph } from "./scanner-core";
import { scanProject } from "./scanner";
import type { GraphEdge, GraphNode } from "./contract";
import type { GraphSnapshot } from "./persistence";

interface BatchFixture {
  root: string;
  rootFile: string;
  coreFile: string;
  alternateFile: string;
  mainFile: string;
  collisionFile: string;
  rootConfig: string;
  coreConfig: string;
  alternateConfig: string;
  appConfig: string;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function createBatchFixture(): BatchFixture {
  const root = mkdtempSync(join(tmpdir(), "repo-graph-batched-independent-"));
  const rootFile = join(root, "src/root.ts");
  const coreFile = join(root, "packages/core/src/math.ts");
  const alternateFile = join(root, "packages/alternate/src/math.ts");
  const mainFile = join(root, "apps/client/src/main.ts");
  const collisionFile = join(root, "apps/client/src/collision.ts");
  const rootConfig = join(root, "tsconfig.json");
  const coreConfig = join(root, "packages/core/tsconfig.json");
  const alternateConfig = join(root, "packages/alternate/tsconfig.json");
  const appConfig = join(root, "apps/client/tsconfig.json");

  for (const directory of [
    join(root, "src"),
    join(root, "packages/core/src"),
    join(root, "packages/alternate/src"),
    join(root, "apps/client/src"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }

  const sharedCompilerOptions = {
    target: "ES2020",
    module: "ESNext",
    moduleResolution: "bundler",
    strict: true,
    skipLibCheck: true,
  };
  writeJson(rootConfig, {
    compilerOptions: sharedCompilerOptions,
    include: ["src/**/*", "packages/**/*", "apps/**/*"],
  });
  writeJson(coreConfig, {
    compilerOptions: sharedCompilerOptions,
    include: ["src/**/*"],
  });
  writeJson(alternateConfig, {
    compilerOptions: sharedCompilerOptions,
    include: ["src/**/*"],
  });
  writeJson(appConfig, {
    compilerOptions: {
      ...sharedCompilerOptions,
      baseUrl: ".",
      paths: {
        "@core/*": ["../../packages/core/src/*"],
        "@alternate/*": ["../../packages/alternate/src/*"],
      },
    },
    include: ["src/**/*"],
  });

  writeFileSync(rootFile, "export const rootValue = 1;\n");
  writeFileSync(
    coreFile,
    [
      "export function namedValue(): number { return 2; }",
      "export function aliasedValue(): number { return 3; }",
      "export function colliding(): number { return 4; }",
      "export default function (): number { return 5; }",
    ].join("\n") + "\n",
  );
  writeFileSync(
    alternateFile,
    "export function colliding(): number { return 6; }\n",
  );
  writeFileSync(
    mainFile,
    [
      'import loadDefault, { namedValue, aliasedValue as renamed, colliding as coreCollision } from "@core/math";',
      'import { colliding as alternateCollision } from "@alternate/math";',
      "export function run(): number {",
      "  return namedValue() + renamed() + coreCollision() + alternateCollision() + loadDefault();",
      "}",
    ].join("\n") + "\n",
  );
  writeFileSync(
    collisionFile,
    [
      'import { colliding as coreCollision } from "@core/math";',
      'import { colliding } from "@alternate/math";',
      "export function collisionRun(): number {",
      "  return coreCollision() + colliding();",
      "}",
    ].join("\n") + "\n",
  );

  return {
    root,
    rootFile,
    coreFile,
    alternateFile,
    mainFile,
    collisionFile,
    rootConfig,
    coreConfig,
    alternateConfig,
    appConfig,
  };
}

function batchFilesFor(
  fixture: BatchFixture,
  tsConfigPath: string,
): string[] {
  const plan = planProjectBatches(fixture.root);
  return plan.batches.find((batch) => batch.tsConfigPath === tsConfigPath)?.filePaths ?? [];
}

function functionNode(
  snapshot: GraphSnapshot,
  filePath: string,
  name: string,
): GraphNode {
  const node = snapshot.nodes.find((candidate) =>
    candidate.type === "function"
    && candidate.filePath === filePath
    && candidate.name === name
  );
  if (!node) throw new Error(`Missing function node ${name} in ${filePath}`);
  return node;
}

function resolvedCallsFrom(
  snapshot: GraphSnapshot,
  sourceId: string,
): GraphEdge[] {
  return snapshot.edges.filter((edge) =>
    edge.type === "calls"
    && edge.source === sourceId
    && JSON.parse(edge.metadata ?? "{}").resolution === "resolved"
  );
}

function assertAstFree(value: unknown, location = "$", seen = new Set<object>()): void {
  if (typeof value === "function") {
    throw new Error(`Function retained in graph fragment at ${location}`);
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) {
    throw new Error(`Cyclic object retained in graph fragment at ${location}`);
  }
  seen.add(value);

  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype
    && prototype !== Array.prototype
    && prototype !== null
  ) {
    throw new Error(`Non-plain object retained in graph fragment at ${location}`);
  }
  const candidate = value as Record<string, unknown>;
  for (const method of [
    "getKind",
    "getSourceFile",
    "getDescendants",
    "getFilePath",
    "getProject",
    "forget",
    "wasForgotten",
  ]) {
    if (typeof candidate[method] === "function") {
      throw new Error(`ts-morph method ${method} retained at ${location}`);
    }
  }
  for (const [key, child] of Object.entries(candidate)) {
    assertAstFree(child, `${location}.${key}`, seen);
  }
  seen.delete(value);
}

describe("independent sequential batch contracts", () => {
  it("assigns overlapping root and nested tsconfig files to the deepest unique owner", () => {
    const fixture = createBatchFixture();
    try {
      const plan = planProjectBatches(fixture.root);
      const allClaims = plan.batches.flatMap((batch) => batch.filePaths).sort();

      expect(allClaims).toEqual(plan.filePaths);
      expect(new Set(allClaims).size).toBe(allClaims.length);
      expect(batchFilesFor(fixture, fixture.rootConfig)).toEqual([fixture.rootFile]);
      expect(batchFilesFor(fixture, fixture.coreConfig)).toEqual([fixture.coreFile]);
      expect(batchFilesFor(fixture, fixture.alternateConfig)).toEqual([
        fixture.alternateFile,
      ]);
      expect(batchFilesFor(fixture, fixture.appConfig)).toEqual([
        fixture.collisionFile,
        fixture.mainFile,
      ]);
      expect(plan.packageMap.get(fixture.coreFile)).toBe("core");
      expect(plan.packageMap.get(fixture.alternateFile)).toBe("alternate");
      expect(plan.packageMap.get(fixture.mainFile)).toBe("client");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 60_000);

  it("opens and releases one Project at a time and repeats deterministically", async () => {
    const fixture = createBatchFixture();
    const events: Array<{ kind: "open" | "release"; path: string; active: number }> = [];
    try {
      const first = await scanProjectBatches(fixture.root, {
        onProjectOpened: (path, active) => events.push({ kind: "open", path, active }),
        onProjectReleased: (path, active) => events.push({ kind: "release", path, active }),
      });
      const second = await scanProjectBatches(fixture.root);

      expect(first.maxActiveProjects).toBe(1);
      expect(second.maxActiveProjects).toBe(1);
      expect(events).toHaveLength(first.tsConfigPaths.length * 2);
      for (let index = 0; index < events.length; index += 2) {
        expect(events[index]).toEqual({
          kind: "open",
          path: events[index].path,
          active: 1,
        });
        expect(events[index + 1]).toEqual({
          kind: "release",
          path: events[index].path,
          active: 0,
        });
      }
      expect(second.tsConfigPaths).toEqual(first.tsConfigPaths);
      expect(second.filePaths).toEqual(first.filePaths);
      expect(JSON.stringify(second.snapshot)).toBe(JSON.stringify(first.snapshot));
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 120_000);

  it("emits a JSON-serializable fragment containing no ts-morph objects or methods", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/fragment.ts",
      "export function run(): number { return helper(); }\n"
        + "export function helper(): number { return 1; }\n",
    );

    const fragment = extractProjectGraph(project);
    assertAstFree(fragment);
    const serialized = JSON.stringify(fragment);
    const roundTrip = JSON.parse(serialized);

    expect(serialized).toBe(JSON.stringify(roundTrip));
    expect(roundTrip).toEqual(expect.objectContaining({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      symbolLookups: expect.any(Array),
      importBindings: expect.any(Array),
      deferredCalls: expect.any(Array),
    }));
  }, 60_000);

  it("resolves path-alias named, aliased, and collision-scoped calls", async () => {
    const fixture = createBatchFixture();
    try {
      const { snapshot } = await scanProjectBatches(fixture.root);
      const run = functionNode(snapshot, fixture.mainFile, "run");
      const callsByExpression = new Map(
        resolvedCallsFrom(snapshot, run.id).map((edge) => [
          JSON.parse(edge.metadata ?? "{}").expression as string,
          edge.target,
        ]),
      );

      expect(callsByExpression.get("namedValue")).toBe(
        `function:${fixture.coreFile}:namedValue`,
      );
      expect(callsByExpression.get("renamed")).toBe(
        `function:${fixture.coreFile}:aliasedValue`,
      );
      expect(callsByExpression.get("coreCollision")).toBe(
        `function:${fixture.coreFile}:colliding`,
      );
      expect(callsByExpression.get("alternateCollision")).toBe(
        `function:${fixture.alternateFile}:colliding`,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 120_000);

  it("resolves a path-alias anonymous default export without unresolved nodes", async () => {
    const fixture = createBatchFixture();
    try {
      const { snapshot } = await scanProjectBatches(fixture.root);
      const run = functionNode(snapshot, fixture.mainFile, "run");
      const defaultCall = resolvedCallsFrom(snapshot, run.id).find((edge) =>
        JSON.parse(edge.metadata ?? "{}").expression === "loadDefault"
      );

      expect(defaultCall?.target).toBe(
        `function:${fixture.coreFile}:default`,
      );
      expect(snapshot.nodes.filter((node) =>
        node.id.startsWith(`unresolved-call:${fixture.mainFile}:`)
      )).toEqual([]);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 120_000);

  it("matches monolithic import-binding collision ordering", async () => {
    const fixture = createBatchFixture();
    try {
      const project = new Project({ tsConfigFilePath: fixture.appConfig });
      project.addSourceFilesAtPaths([fixture.coreFile, fixture.alternateFile]);
      const monolithic = scanProject(project);
      const monolithicRun = functionNode(
        monolithic,
        fixture.collisionFile,
        "collisionRun",
      );
      const { snapshot: batched } = await scanProjectBatches(fixture.root);
      const batchedRun = functionNode(batched, fixture.collisionFile, "collisionRun");
      const callsByExpression = (
        snapshot: GraphSnapshot,
        sourceId: string,
      ): Record<string, string> => Object.fromEntries(
        resolvedCallsFrom(snapshot, sourceId).map((edge) => [
          JSON.parse(edge.metadata ?? "{}").expression as string,
          edge.target,
        ]),
      );

      expect(callsByExpression(batched, batchedRun.id)).toEqual(
        callsByExpression(monolithic, monolithicRun.id),
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, 120_000);
});
