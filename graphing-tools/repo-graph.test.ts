import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { main } from "./repo-graph";

const fixture = join(process.cwd(), "graphing-tools/fixtures/sample-project");

describe("repo-graph command dispatch", () => {
  it("runs the canonical command surface against a persisted fixture", async () => {
    const tempDir = mkdtempSync("/tmp/repo-graph-cli-");
    const dbPath = join(tempDir, "graph.db");
    const hooksPath = join(tempDir, ".git");

    try {
      expect(await main(["bun", "repo-graph", "init", dbPath])).toBe(0);
      expect(await main(["bun", "repo-graph", "scan", fixture, dbPath])).toBe(0);
      expect(await main(["bun", "repo-graph", "query", "--json", dbPath, "SELECT COUNT(*) AS count FROM nodes"])).toBe(0);
      expect(await main(["bun", "repo-graph", "search", dbPath, "formatName", "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "stats", dbPath, "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "files", dbPath, "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "inspect", dbPath, "formatName", "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "callers", dbPath, "formatName", "--json"])).toBe(1);
      expect(await main(["bun", "repo-graph", "deps", dbPath, "formatName", "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "path", dbPath, "formatName", "calculateSum", "--json"])).toBe(1);
      expect(await main(["bun", "repo-graph", "explore", dbPath, "formatName", "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "affected", dbPath, "auth.ts", "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "impact", dbPath, "formatName", "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "audit", dbPath, "--json", "--docs"])).toBe(0);
      expect(await main(["bun", "repo-graph", "update", dbPath, "--json"])).toBe(0);
      expect(await main(["bun", "repo-graph", "install-hooks", "--path", hooksPath, "--json"])).toBe(0);
      expect(existsSync(join(hooksPath, "hooks/pre-commit"))).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 60000);

  it("dispatches root, per-command help, config, and version output", async () => {
    const commands = ["scan", "config", "update", "install-hooks", "query", "search", "deps", "callers", "path", "stats", "files", "init", "inspect", "audit", "explore", "affected", "impact", "version"];
    expect(await main(["bun", "repo-graph", "--help"])).toBe(0);
    for (const command of commands) {
      expect(await main(["bun", "repo-graph", "help", command])).toBe(0);
    }
  });
});
