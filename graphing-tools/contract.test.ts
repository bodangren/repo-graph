import { describe, it, expect } from "bun:test";
import {
  ExitCode,
  MATCH_SCORING_ORDER,
  OutputLimits,
  IMPACT_TRAVERSAL_EDGE_TYPES,
  TEST_FILE_PATTERNS,
  AFFECTED_GROUP_NAMES,
  type NodeType,
  type EdgeType,
  type Subcommand,
  type ExploreArgs,
  type AffectedArgs,
  type ImpactArgs,
  type ExploreOutput,
  type AffectedOutput,
  type ImpactOutput,
  type FileFreshnessEntry,
  type FreshnessBlock,
  type RelationshipEntry,
  type SourceSnippet,
  type AffectedFileEntry,
  type AffectedGroup,
  type TruncationMeta,
  type GraphMetadata,
  type InstallHooksArgs,
  type UpdateArgs,
} from "./contract";

describe("ExitCode", () => {
  it("has correct values", () => {
    expect(ExitCode.Success).toBe(0);
    expect(ExitCode.NotFound).toBe(1);
    expect(ExitCode.Ambiguous).toBe(2);
    expect(ExitCode.Misuse).toBe(3);
    expect(ExitCode.RuntimeError).toBe(4);
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
      "help", "version", "inspect",
    ];
    expect(cmds.length).toBe(13);
  });

  it("includes explore, affected, and impact subcommands", () => {
    const explore: Subcommand = "explore";
    const affected: Subcommand = "affected";
    const impact: Subcommand = "impact";
    expect(explore).toBe("explore");
    expect(affected).toBe("affected");
    expect(impact).toBe("impact");
  });
});

// ── Explore / Affected / Impact argument shapes ─────────────────────────────

describe("ExploreArgs", () => {
  it("has the expected fields", () => {
    const args: ExploreArgs = {
      dbPath: "graph.db",
      query: "lesson",
      json: true,
      limit: 20,
      depth: 3,
      includeSource: true,
    };
    expect(args.dbPath).toBe("graph.db");
    expect(args.query).toBe("lesson");
    expect(args.json).toBe(true);
    expect(args.limit).toBe(20);
    expect(args.depth).toBe(3);
    expect(args.includeSource).toBe(true);
  });
});

describe("AffectedArgs", () => {
  it("has the expected fields", () => {
    const args: AffectedArgs = {
      dbPath: "graph.db",
      files: ["src/app.ts"],
      stdin: false,
      json: true,
      depth: 3,
      testsOnly: false,
      filter: "*.test.ts",
    };
    expect(args.dbPath).toBe("graph.db");
    expect(args.files).toEqual(["src/app.ts"]);
    expect(args.stdin).toBe(false);
    expect(args.json).toBe(true);
    expect(args.depth).toBe(3);
    expect(args.testsOnly).toBe(false);
    expect(args.filter).toBe("*.test.ts");
  });
});

describe("ImpactArgs", () => {
  it("has the expected fields", () => {
    const args: ImpactArgs = {
      dbPath: "graph.db",
      nodeOrFile: "scienceLessons.id",
      json: true,
      depth: 3,
      edgeType: "imports",
      includeSource: false,
    };
    expect(args.dbPath).toBe("graph.db");
    expect(args.nodeOrFile).toBe("scienceLessons.id");
    expect(args.json).toBe(true);
    expect(args.depth).toBe(3);
    expect(args.edgeType).toBe("imports");
    expect(args.includeSource).toBe(false);
  });
});

// ── Output payload types ────────────────────────────────────────────────────

describe("ExploreOutput", () => {
  it("has the documented top-level keys", () => {
    const out: ExploreOutput = {
      query: "lesson",
      matches: [],
      relationships: [],
      sourceSnippets: [],
      freshness: { stale: [], missing: [], checkedAt: 0 },
      truncated: false,
    };
    expect(out.query).toBe("lesson");
    expect(out.matches).toEqual([]);
    expect(out.relationships).toEqual([]);
    expect(out.sourceSnippets).toEqual([]);
    expect(out.freshness.stale).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it("allows optional nextQuery", () => {
    const out: ExploreOutput = {
      query: "x",
      matches: [],
      relationships: [],
      sourceSnippets: [],
      freshness: { stale: [], missing: [], checkedAt: 0 },
      truncated: true,
      nextQuery: "lesson route",
    };
    expect(out.nextQuery).toBe("lesson route");
  });
});

describe("AffectedOutput", () => {
  it("has the documented top-level keys", () => {
    const out: AffectedOutput = {
      changedFiles: ["src/app.ts"],
      affected: [],
      truncated: false,
      testsOnly: false,
    };
    expect(out.changedFiles).toEqual(["src/app.ts"]);
    expect(out.affected).toEqual([]);
    expect(out.truncated).toBe(false);
    expect(out.testsOnly).toBe(false);
  });
});

describe("ImpactOutput", () => {
  it("has the documented top-level keys", () => {
    const out: ImpactOutput = {
      root: "scienceLessons.id",
      relationships: [],
      affectedTests: [],
      freshness: { stale: [], missing: [], checkedAt: 0 },
      truncated: false,
    };
    expect(out.root).toBe("scienceLessons.id");
    expect(out.relationships).toEqual([]);
    expect(out.affectedTests).toEqual([]);
    expect(out.freshness.stale).toEqual([]);
    expect(out.truncated).toBe(false);
  });
});

describe("FileFreshnessEntry", () => {
  it("supports current, stale, and missing statuses", () => {
    const current: FileFreshnessEntry = { path: "a.ts", status: "current" };
    const stale: FileFreshnessEntry = { path: "b.ts", status: "stale", indexedAt: 100, modifiedAt: 200 };
    const missing: FileFreshnessEntry = { path: "c.ts", status: "missing" };
    expect(current.status).toBe("current");
    expect(stale.status).toBe("stale");
    expect(missing.status).toBe("missing");
  });
});

describe("RelationshipEntry", () => {
  it("has the expected fields", () => {
    const entry: RelationshipEntry = {
      sourceId: "function:a.ts:foo",
      targetId: "function:b.ts:bar",
      edgeType: "calls",
      direction: "forward",
      targetName: "bar",
      targetFilePath: "b.ts",
      targetType: "function",
    };
    expect(entry.edgeType).toBe("calls");
    expect(entry.direction).toBe("forward");
  });
});

describe("SourceSnippet", () => {
  it("has the expected fields", () => {
    const snippet: SourceSnippet = {
      nodeId: "function:a.ts:foo",
      filePath: "a.ts",
      lineStart: 10,
      lineEnd: 20,
      content: "const x = 1;",
      truncated: false,
    };
    expect(snippet.lineStart).toBe(10);
    expect(snippet.lineEnd).toBe(20);
    expect(snippet.truncated).toBe(false);
  });
});

describe("AffectedFileEntry", () => {
  it("has group and paths", () => {
    const entry: AffectedFileEntry = {
      path: "tests/foo.test.ts",
      group: "tests",
      paths: [["src/app.ts", "tests/foo.test.ts"]],
    };
    expect(entry.group).toBe("tests");
    expect(entry.paths).toHaveLength(1);
  });
});

describe("AffectedGroup", () => {
  it("includes all required group names", () => {
    const groups: AffectedGroup[] = ["tests", "routes", "components", "dataAccess", "other"];
    expect(groups).toHaveLength(5);
  });
});

describe("TruncationMeta", () => {
  it("has the expected fields", () => {
    const meta: TruncationMeta = {
      truncated: true,
      totalAvailable: 50,
      returned: 20,
      nextQuery: "use --offset 20",
    };
    expect(meta.truncated).toBe(true);
    expect(meta.totalAvailable).toBe(50);
    expect(meta.returned).toBe(20);
  });
});

// ── Ranking and output budgets ──────────────────────────────────────────────

describe("MATCH_SCORING_ORDER", () => {
  it("starts with exact_node_name and ends with relationship_proximity", () => {
    expect(MATCH_SCORING_ORDER[0]).toBe("exact_node_name");
    expect(MATCH_SCORING_ORDER[MATCH_SCORING_ORDER.length - 1]).toBe("relationship_proximity");
  });

  it("has 5 scoring criteria", () => {
    expect(MATCH_SCORING_ORDER).toHaveLength(5);
  });
});

describe("OutputLimits", () => {
  it("defines matches default as 20", () => {
    expect(OutputLimits.matches).toBe(20);
  });

  it("defines relationshipFanout default as 50", () => {
    expect(OutputLimits.relationshipFanout).toBe(50);
  });

  it("defines traversalDepth default as 3", () => {
    expect(OutputLimits.traversalDepth).toBe(3);
  });

  it("defines sourceSnippetLines default as 10", () => {
    expect(OutputLimits.sourceSnippetLines).toBe(10);
  });
});

// ── Traversal semantics ─────────────────────────────────────────────────────

describe("IMPACT_TRAVERSAL_EDGE_TYPES", () => {
  it("includes the 9 required edge types", () => {
    const expected: EdgeType[] = [
      "imports", "calls", "references", "renders",
      "queries", "mutates", "param_flow", "uses_hook", "tested_by",
    ];
    expect(IMPACT_TRAVERSAL_EDGE_TYPES).toEqual(expected);
  });

  it("does not include contains or depends_on", () => {
    expect(IMPACT_TRAVERSAL_EDGE_TYPES).not.toContain("contains");
    expect(IMPACT_TRAVERSAL_EDGE_TYPES).not.toContain("depends_on");
  });
});

describe("TEST_FILE_PATTERNS", () => {
  it("includes the 7 default patterns", () => {
    expect(TEST_FILE_PATTERNS).toHaveLength(7);
  });

  it("includes test.ts and spec.ts patterns", () => {
    expect(TEST_FILE_PATTERNS).toContain("*.test.ts");
    expect(TEST_FILE_PATTERNS).toContain("*.test.tsx");
    expect(TEST_FILE_PATTERNS).toContain("*.spec.ts");
    expect(TEST_FILE_PATTERNS).toContain("*.spec.tsx");
  });

  it("includes __tests__, e2e, and playwright directory patterns", () => {
    expect(TEST_FILE_PATTERNS).toContain("__tests__/**");
    expect(TEST_FILE_PATTERNS).toContain("e2e/**");
    expect(TEST_FILE_PATTERNS).toContain("playwright/**");
  });
});

describe("AFFECTED_GROUP_NAMES", () => {
  it("includes 5 groups in priority order", () => {
    expect(AFFECTED_GROUP_NAMES).toEqual(["tests", "routes", "components", "dataAccess", "other"]);
  });
});

// ── Git hook integration contracts ──────────────────────────────────────────

describe("GraphMetadata", () => {
  it("has schemaVersion and commitSha fields", () => {
    const m: GraphMetadata = { schemaVersion: "1.0.0", commitSha: "abc123" };
    expect(m.schemaVersion).toBe("1.0.0");
    expect(m.commitSha).toBe("abc123");
  });

  it("allows commitSha to be null", () => {
    const m: GraphMetadata = { schemaVersion: "1.0.0", commitSha: null };
    expect(m.commitSha).toBeNull();
  });

  it("allows optional lastIndexedAt", () => {
    const m: GraphMetadata = { schemaVersion: "1.0.0", commitSha: null, lastIndexedAt: 1700000000 };
    expect(m.lastIndexedAt).toBe(1700000000);
  });
});

describe("Subcommand union", () => {
  it("includes install-hooks subcommand", () => {
    const cmd: Subcommand = "install-hooks";
    expect(cmd).toBe("install-hooks");
  });
});

describe("InstallHooksArgs", () => {
  it("has optional path, force, and json fields", () => {
    const args: InstallHooksArgs = { path: ".git/hooks", force: true, json: false };
    expect(args.path).toBe(".git/hooks");
    expect(args.force).toBe(true);
    expect(args.json).toBe(false);
  });

  it("allows all fields to be omitted", () => {
    const args: InstallHooksArgs = {};
    expect(args.path).toBeUndefined();
    expect(args.force).toBeUndefined();
    expect(args.json).toBeUndefined();
  });
});

describe("UpdateArgs", () => {
  it("has optional json field", () => {
    const args: UpdateArgs = { dbPath: "graph.db", filePaths: ["src/app.ts"], json: true };
    expect(args.json).toBe(true);
  });
});
