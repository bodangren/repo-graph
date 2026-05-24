import { describe, it, expect } from "bun:test";
import { parseArgs, validateInputFile, main } from "./build-graph-db";

describe("parseArgs", () => {
  it("returns input and output paths for valid args", () => {
    const result = parseArgs(["bun", "script.ts", "input.json", "output.db"]);
    expect(result.inputPath).toBe("input.json");
    expect(result.outputPath).toBe("output.db");
  });

  it("throws for missing args", () => {
    expect(() => parseArgs(["bun", "script.ts"])).toThrow("Usage:");
  });

  it("throws for single arg", () => {
    expect(() => parseArgs(["bun", "script.ts", "input.json"])).toThrow("Usage:");
  });
});

describe("validateInputFile", () => {
  it("throws for missing file", async () => {
    await expect(
      validateInputFile("/nonexistent/file.json")
    ).rejects.toThrow("not found");
  });

  it("does not throw for existing file", async () => {
    const tmp = "/tmp/test-graph-db-input.json";
    await Bun.write(tmp, "{}");
    await expect(validateInputFile(tmp)).resolves.toBeUndefined();
  });
});

describe("main", () => {
  it("runs buildGraphDb for valid args and existing file", async () => {
    const tmp = "/tmp/test-graph-db-input-2.json";
    const out = "/tmp/test-graph-db-output.db";
    await Bun.write(tmp, "{}");
    await expect(main(["bun", "script.ts", tmp, out])).resolves.toBeUndefined();
    expect(await Bun.file(out).exists()).toBe(true);
    try { require("fs").unlinkSync(out); } catch { /* ignore */ }
  });
});

describe("CLI subprocess", () => {
  const script = import.meta.resolveSync("./build-graph-db.ts");

  it("exits 2 when args are missing", async () => {
    const proc = Bun.spawn(["bun", "run", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(2);
  });

  it("exits 1 when input file is missing", async () => {
    const proc = Bun.spawn(["bun", "run", script, "/nonexistent.json", "out.db"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(1);
  });
});
