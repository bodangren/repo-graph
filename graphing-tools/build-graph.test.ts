import { describe, it, expect } from "bun:test";
import { createProject } from "./repo-graph";

describe("createProject", () => {
  it("falls back to globbing when root tsconfig has empty include", async () => {
    const { project, tsConfigPaths } = await createProject(
      "./graphing-tools/fixtures/empty-include"
    );
    const files = project.getSourceFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.getFilePath().includes("app.ts"))).toBe(true);
    expect(tsConfigPaths).toEqual([]);
  });

  it("still uses tsconfig when include is non-empty", async () => {
    const { project, tsConfigPaths } = await createProject(
      "./graphing-tools/fixtures/sample-project"
    );
    const files = project.getSourceFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(tsConfigPaths.length).toBeGreaterThan(0);
  });
});
