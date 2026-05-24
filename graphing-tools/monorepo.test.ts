import { describe, it, expect } from "bun:test";
import { createProject } from "./build-graph";
import { scanProject } from "./scanner";

describe("createProject with multiple tsconfigs", () => {
  it("discovers all packages in a monorepo", async () => {
    const project = await createProject("./graphing-tools/fixtures/monorepo");
    const sourceFiles = project.getSourceFiles();
    const paths = sourceFiles.map((sf) => sf.getFilePath());

    expect(paths.some((p) => p.includes("frontend/src/app.ts"))).toBe(true);
    expect(paths.some((p) => p.includes("convex/src/api.ts"))).toBe(true);
  });

  it("extracts nodes from both packages", async () => {
    const project = await createProject("./graphing-tools/fixtures/monorepo");
    const { nodes, edges } = scanProject(project);

    const fileNodes = nodes.filter((n) => n.type === "file");
    expect(fileNodes.length).toBe(2);

    // frontend/src/app.ts has bootstrap function
    const funcNodes = nodes.filter((n) => n.type === "function");
    expect(funcNodes.some((n) => n.name === "bootstrap")).toBe(true);

    // convex/src/api.ts contributes the api object (via contains edge)
    const apiFile = fileNodes.find((n) => n.name === "api.ts");
    expect(apiFile).toBeDefined();
  });

  it("creates import edges between packages", async () => {
    const project = await createProject("./graphing-tools/fixtures/monorepo");
    const { edges } = scanProject(project);

    const importEdges = edges.filter((e) => e.type === "imports");
    expect(importEdges.length).toBeGreaterThan(0);
  });
});
