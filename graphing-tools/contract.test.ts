import { describe, it, expect } from "bun:test";
import {
  ExitCode,
  type NodeType,
  type EdgeType,
  type Subcommand,
} from "./contract";

describe("ExitCode", () => {
  it("has correct values", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.RuntimeError).toBe(1);
    expect(ExitCode.Misuse).toBe(2);
  });
});

describe("NodeType union", () => {
  it("includes all required types", () => {
    const types: NodeType[] = [
      "file",
      "function",
      "class",
      "interface",
      "type_alias",
      "variable",
      "import",
      "export",
    ];
    expect(types.length).toBe(8);
  });
});

describe("EdgeType union", () => {
  it("includes all required types", () => {
    const types: EdgeType[] = [
      "contains",
      "imports",
      "extends",
      "implements",
      "calls",
      "depends_on",
      "exports",
      "tested_by",
    ];
    expect(types.length).toBe(8);
  });
});

describe("Subcommand union", () => {
  it("includes all required subcommands", () => {
    const cmds: Subcommand[] = [
      "init", "scan", "update", "query", "search",
      "deps", "callers", "path", "stats", "files",
      "help",
    ];
    expect(cmds.length).toBe(11);
  });
});
