import { describe, expect, it, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { scanProject } from "./scanner";
import { planProjectBatches } from "./batched-scan";
import {
  createProject,
  getPackageIdForFile,
  main,
  scanProjectBatches,
} from "./repo-graph";
import { createSchema } from "./schema";

function packageMapFor(paths: string[], tsConfigPaths: string[]): Map<string, string> {
  return new Map(paths.map((path) => [path, getPackageIdForFile(path, tsConfigPaths)]));
}

describe("package-batched full scanning", () => {
  it("matches the monolithic snapshot for the committed monorepo fixture", async () => {
    const root = resolve("./graphing-tools/fixtures/monorepo");
    const { project, tsConfigPaths } = await createProject(root);
    const paths = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath());
    const expected = scanProject(project, packageMapFor(paths, tsConfigPaths));

    const actual = await scanProjectBatches(root);

    expect(actual.tsConfigPaths).toHaveLength(2);
    expect(actual.filePaths).toEqual([...paths].sort());
    expect(actual.snapshot.nodes).toEqual(expected.nodes);
    expect(actual.snapshot.edges).toEqual(expected.edges);
  }, 120_000);

  it("preserves a resolved call across package boundaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "repo-graph-batched-"));
    try {
      const lib = join(root, "packages/lib");
      const app = join(root, "apps/app");
      mkdirSync(join(lib, "src"), { recursive: true });
      mkdirSync(join(app, "src"), { recursive: true });
      writeFileSync(join(lib, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
        },
        include: ["src/**/*"],
      }));
      writeFileSync(join(app, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
        },
        include: ["src/**/*"],
      }));
      writeFileSync(
        join(lib, "src/value.ts"),
        "export function value(): number { return 7; }\n",
      );
      writeFileSync(
        join(app, "src/main.ts"),
        [
          'import { value } from "../../../packages/lib/src/value";',
          "export function read(): number { return value(); }",
        ].join("\n"),
      );

      const { project, tsConfigPaths } = await createProject(root);
      const paths = project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath());
      const expected = scanProject(project, packageMapFor(paths, tsConfigPaths));
      const actual = await scanProjectBatches(root);

      expect(actual.snapshot.nodes).toEqual(expected.nodes);
      expect(actual.snapshot.edges).toEqual(expected.edges);
      expect(actual.snapshot.edges).toContainEqual(expect.objectContaining({
        source: expect.stringContaining("/apps/app/src/main.ts:read"),
        target: expect.stringContaining("/packages/lib/src/value.ts:value"),
        type: "calls",
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("leaves an existing database untouched when a discovered config cannot parse", async () => {
    const root = mkdtempSync(join(tmpdir(), "repo-graph-batched-failure-"));
    const dbPath = join(root, "graph.db");
    try {
      const valid = join(root, "a-valid");
      const invalid = join(root, "z-invalid");
      mkdirSync(join(valid, "src"), { recursive: true });
      mkdirSync(invalid, { recursive: true });
      writeFileSync(join(valid, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "ES2020" },
        include: ["src/**/*"],
      }));
      writeFileSync(join(valid, "src/index.ts"), "export const ready = true;\n");
      writeFileSync(join(invalid, "tsconfig.json"), "{ this is not valid json");

      const existing = new Database(dbPath);
      createSchema(existing);
      existing.exec(
        "INSERT INTO nodes (id, type, name, file_path) VALUES ('sentinel', 'file', 'sentinel.ts', '/sentinel.ts')",
      );
      existing.close();

      await expect(main(["bun", "repo-graph", "scan", root, dbPath])).rejects.toThrow(
        "Could not parse TypeScript configuration",
      );

      const preserved = new Database(dbPath);
      expect(preserved.prepare("SELECT name FROM nodes WHERE id = 'sentinel'").get())
        .toEqual({ name: "sentinel.ts" });
      preserved.close();
      expect(readdirSync(root).filter((name) => name.includes(".tmp."))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("writes complete stage diagnostics to stderr without changing stdout", async () => {
    const root = mkdtempSync(join(tmpdir(), "repo-graph-batched-diagnostics-"));
    const dbPath = join(root, "graph.db");
    const stderr: string[] = [];
    const stdout: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation((...args) => {
      stderr.push(args.map(String).join(" "));
    });
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.map(String).join(" "));
    });
    try {
      for (const name of ["alpha", "beta"]) {
        const packageRoot = join(root, "packages", name);
        mkdirSync(join(packageRoot, "src"), { recursive: true });
        writeFileSync(join(packageRoot, "tsconfig.json"), JSON.stringify({
          compilerOptions: { target: "ES2020" },
          include: ["src/**/*"],
        }));
        writeFileSync(
          join(packageRoot, "src/index.ts"),
          `export function ${name}(): string { return "${name}"; }\n`,
        );
      }

      await main(["bun", "repo-graph", "scan", root, dbPath]);

      for (const stage of [
        "project_discovery",
        "primary_extraction",
        "schema_pass",
        "framework_pass",
        "string_literal_pass",
        "param_flow_pass",
        "route_pass",
        "call_resolution",
        "deduplication",
        "persistence",
      ]) {
        expect(stderr.some((line) => line.includes(`Stage ${stage}`))).toBe(true);
      }
      expect(stderr.every((line) =>
        !line.startsWith("Stage ")
        || (/\d+ms; RSS \d+ MiB/.test(line))
      )).toBe(true);
      expect(stdout).toEqual([]);
      expect(readdirSync(root).filter((name) => name.includes(".tmp."))).toEqual([]);
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("splits an oversized TypeScript configuration into bounded deterministic sub-batches", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-graph-batched-oversized-"));
    try {
      const sourceRoot = join(root, "src");
      mkdirSync(sourceRoot, { recursive: true });
      const tsConfigPath = join(root, "tsconfig.json");
      writeFileSync(tsConfigPath, JSON.stringify({
        compilerOptions: { target: "ES2020" },
        include: ["src/**/*"],
      }));
      for (let index = 0; index < 193; index++) {
        writeFileSync(
          join(sourceRoot, `file-${index.toString().padStart(3, "0")}.ts`),
          `export const value${index} = ${index};\n`,
        );
      }

      const plan = planProjectBatches(root);
      const batches = plan.batches.filter(
        (batch) => batch.tsConfigPath === tsConfigPath,
      );
      expect(batches.map((batch) => batch.filePaths.length)).toEqual([
        32, 32, 32, 32, 32, 32, 1,
      ]);
      expect(batches.flatMap((batch) => batch.filePaths)).toEqual(plan.filePaths);
      expect(new Set(batches.flatMap((batch) => batch.filePaths)).size).toBe(193);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

});
