import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";

describe("project layout", () => {
  it("has a tsconfig.json at project root", () => {
    expect(existsSync("tsconfig.json")).toBe(true);
  });

  it("tsconfig includes graphing-tools", async () => {
    const file = Bun.file("tsconfig.json");
    const config = await file.json();
    expect(config.include).toContain("graphing-tools/**/*.ts");
  });

  it("has a barrel export in graphing-tools/index.ts", () => {
    expect(existsSync("graphing-tools/index.ts")).toBe(true);
  });

  it("barrel exports parseArgs, validateInputFile, and main", async () => {
    const { parseArgs, validateInputFile, main } = await import("./index");
    expect(typeof parseArgs).toBe("function");
    expect(typeof validateInputFile).toBe("function");
    expect(typeof main).toBe("function");
  });

  it("moves legacy scripts into legacy/ subdirectory", () => {
    expect(existsSync("graphing-tools/legacy/build-fingerprints.mjs")).toBe(true);
    expect(existsSync("graphing-tools/legacy/extract-structure.mjs")).toBe(true);
    expect(existsSync("graphing-tools/legacy/merge-batch-graphs.py")).toBe(true);
  });
});
