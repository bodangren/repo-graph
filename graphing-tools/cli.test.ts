import { describe, it, expect } from "bun:test";
import { parseArgs } from "./cli";

describe("parseArgs", () => {
  // Helper: simulate process.argv shape
  const argv = (args: string[]) => ["bun", "build-graph.ts", ...args];

  describe("init", () => {
    it("parses init <db>", () => {
      const result = parseArgs(argv(["init", "./graph.db"]));
      expect(result.subcommand).toBe("init");
      expect(result.args.dbPath).toBe("./graph.db");
    });

    it("throws on missing db path", () => {
      expect(() => parseArgs(argv(["init"]))).toThrow("Usage: build-graph init <db>");
    });
  });

  describe("scan", () => {
    it("parses scan <dir> <db>", () => {
      const result = parseArgs(argv(["scan", "./", "./graph.db"]));
      expect(result.subcommand).toBe("scan");
      expect(result.args.projectDir).toBe("./");
      expect(result.args.dbPath).toBe("./graph.db");
    });

    it("throws on missing args", () => {
      expect(() => parseArgs(argv(["scan"]))).toThrow("Usage: build-graph scan <project-dir> <db>");
      expect(() => parseArgs(argv(["scan", "./"]))).toThrow("Usage: build-graph scan <project-dir> <db>");
    });

    it("parses scan with --config flag", () => {
      const result = parseArgs(argv(["scan", "./", "./graph.db", "--config", "./my-config.json"]));
      expect(result.subcommand).toBe("scan");
      expect(result.args.configPath).toBe("./my-config.json");
    });

    it("parses scan with --config= syntax", () => {
      const result = parseArgs(argv(["scan", "./", "./graph.db", "--config=./my-config.json"]));
      expect(result.subcommand).toBe("scan");
      expect(result.args.configPath).toBe("./my-config.json");
    });

    it("parses scan with single --include flag", () => {
      const result = parseArgs(argv(["scan", "./", "./graph.db", "--include", "data/**/*.json"]));
      expect(result.subcommand).toBe("scan");
      expect(result.args.includePatterns).toEqual(["data/**/*.json"]);
    });

    it("parses scan with multiple --include flags", () => {
      const result = parseArgs(argv(["scan", "./", "./graph.db", "--include", "data/**/*.json", "--include", "migrations/**/*.sql"]));
      expect(result.subcommand).toBe("scan");
      expect(result.args.includePatterns).toEqual(["data/**/*.json", "migrations/**/*.sql"]);
    });

    it("parses scan with --include= syntax", () => {
      const result = parseArgs(argv(["scan", "./", "./graph.db", "--include=data/**/*.json"]));
      expect(result.subcommand).toBe("scan");
      expect(result.args.includePatterns).toEqual(["data/**/*.json"]);
    });
  });

  describe("update", () => {
    it("parses update <db> <file...>", () => {
      const result = parseArgs(argv(["update", "./graph.db", "src/a.ts", "src/b.ts"]));
      expect(result.subcommand).toBe("update");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.filePaths).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("throws on missing files", () => {
      expect(() => parseArgs(argv(["update", "./graph.db"]))).toThrow("Usage: build-graph update <db> <file> [<file> ...]");
    });
  });

  describe("query", () => {
    it("parses query <db> <sql>", () => {
      const result = parseArgs(argv(["query", "./graph.db", "SELECT * FROM nodes"]));
      expect(result.subcommand).toBe("query");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.sql).toBe("SELECT * FROM nodes");
    });

    it("parses query with --json flag", () => {
      const result = parseArgs(argv(["query", "--json", "./graph.db", "SELECT * FROM nodes"]));
      expect(result.subcommand).toBe("query");
      expect(result.args.json).toBe(true);
    });

    it("throws on missing args", () => {
      expect(() => parseArgs(argv(["query"]))).toThrow("Usage: build-graph query <db> <sql>");
      expect(() => parseArgs(argv(["query", "./graph.db"]))).toThrow("Usage: build-graph query <db> <sql>");
    });
  });

  describe("search", () => {
    it("parses search <db> <keyword>", () => {
      const result = parseArgs(argv(["search", "./graph.db", "auth"]));
      expect(result.subcommand).toBe("search");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.keyword).toBe("auth");
    });

    it("throws on missing args", () => {
      expect(() => parseArgs(argv(["search"]))).toThrow("Usage: build-graph search <db> <keyword>");
      expect(() => parseArgs(argv(["search", "./graph.db"]))).toThrow("Usage: build-graph search <db> <keyword>");
    });
  });

  describe("help", () => {
    it("parses --help", () => {
      const result = parseArgs(argv(["--help"]));
      expect(result.subcommand).toBe("help");
    });

    it("parses help <subcommand>", () => {
      const result = parseArgs(argv(["help", "scan"]));
      expect(result.subcommand).toBe("help");
      expect(result.args.subcommand).toBe("scan");
    });
  });

  describe("version", () => {
    it("parses --version", () => {
      const result = parseArgs(argv(["--version"]));
      expect(result.subcommand).toBe("version");
    });

    it("parses -v", () => {
      const result = parseArgs(argv(["-v"]));
      expect(result.subcommand).toBe("version");
    });
  });

  describe("deps", () => {
    it("parses deps <db> <name>", () => {
      const result = parseArgs(argv(["deps", "./graph.db", "foo"]));
      expect(result.subcommand).toBe("deps");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.name).toBe("foo");
      expect(result.args.downstream).toBe(false);
    });

    it("parses deps with --downstream", () => {
      const result = parseArgs(argv(["deps", "./graph.db", "foo", "--downstream"]));
      expect(result.args.downstream).toBe(true);
    });

    it("throws on missing args", () => {
      expect(() => parseArgs(argv(["deps"]))).toThrow("Usage: build-graph deps");
    });

    it("throws when node name is missing with --downstream", () => {
      expect(() => parseArgs(argv(["deps", "./graph.db", "--downstream"]))).toThrow("Usage: build-graph deps");
    });
  });

  describe("callers", () => {
    it("parses callers <db> <name>", () => {
      const result = parseArgs(argv(["callers", "./graph.db", "foo"]));
      expect(result.subcommand).toBe("callers");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.name).toBe("foo");
    });

    it("throws on missing args", () => {
      expect(() => parseArgs(argv(["callers"]))).toThrow("Usage: build-graph callers");
    });
  });

  describe("path", () => {
    it("parses path <db> <from> <to>", () => {
      const result = parseArgs(argv(["path", "./graph.db", "foo", "bar"]));
      expect(result.subcommand).toBe("path");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.from).toBe("foo");
      expect(result.args.to).toBe("bar");
    });

    it("throws on missing args", () => {
      expect(() => parseArgs(argv(["path"]))).toThrow("Usage: build-graph path");
    });
  });

  describe("stats", () => {
    it("parses stats <db>", () => {
      const result = parseArgs(argv(["stats", "./graph.db"]));
      expect(result.subcommand).toBe("stats");
      expect(result.args.dbPath).toBe("./graph.db");
    });

    it("throws on missing db", () => {
      expect(() => parseArgs(argv(["stats"]))).toThrow("Usage: build-graph stats");
    });
  });

  describe("files", () => {
    it("parses files <db>", () => {
      const result = parseArgs(argv(["files", "./graph.db"]));
      expect(result.subcommand).toBe("files");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.pattern).toBeUndefined();
    });

    it("parses files <db> <pattern>", () => {
      const result = parseArgs(argv(["files", "./graph.db", "auth"]));
      expect(result.args.pattern).toBe("auth");
    });
  });

  describe("inspect", () => {
    it("parses inspect <db> <name>", () => {
      const result = parseArgs(argv(["inspect", "./graph.db", "foo"]));
      expect(result.subcommand).toBe("inspect");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.name).toBe("foo");
    });

    it("parses inspect with --json", () => {
      const result = parseArgs(argv(["inspect", "./graph.db", "foo", "--json"]));
      expect(result.args.json).toBe(true);
    });
  });

  describe("audit", () => {
    it("parses audit <db>", () => {
      const result = parseArgs(argv(["audit", "./graph.db"]));
      expect(result.subcommand).toBe("audit");
      expect(result.args.dbPath).toBe("./graph.db");
    });

    it("parses audit with --json", () => {
      const result = parseArgs(argv(["audit", "./graph.db", "--json"]));
      expect(result.args.json).toBe(true);
    });

    it("throws on missing db", () => {
      expect(() => parseArgs(argv(["audit"]))).toThrow("Usage: build-graph audit");
    });
  });

  describe("json flag", () => {
    it("parses deps with --json", () => {
      const result = parseArgs(argv(["deps", "./graph.db", "foo", "--json"]));
      expect(result.args.json).toBe(true);
    });

    it("parses callers with -j", () => {
      const result = parseArgs(argv(["callers", "./graph.db", "foo", "-j"]));
      expect(result.args.json).toBe(true);
    });

    it("parses path with --json", () => {
      const result = parseArgs(argv(["path", "./graph.db", "foo", "bar", "--json"]));
      expect(result.args.json).toBe(true);
    });

    it("parses stats with --json", () => {
      const result = parseArgs(argv(["stats", "./graph.db", "--json"]));
      expect(result.args.json).toBe(true);
    });

    it("parses files with --json", () => {
      const result = parseArgs(argv(["files", "./graph.db", "--json"]));
      expect(result.args.json).toBe(true);
    });

    it("parses search with --json", () => {
      const result = parseArgs(argv(["search", "./graph.db", "auth", "--json"]));
      expect(result.args.json).toBe(true);
    });
  });

  describe("limit flag", () => {
    it("parses deps with --limit 5", () => {
      const result = parseArgs(argv(["deps", "./graph.db", "foo", "--limit", "5"]));
      expect(result.args.limit).toBe(5);
    });

    it("parses callers with --limit 0", () => {
      const result = parseArgs(argv(["callers", "./graph.db", "foo", "--limit", "0"]));
      expect(result.args.limit).toBe(0);
    });

    it("parses files with --limit 10", () => {
      const result = parseArgs(argv(["files", "./graph.db", "--limit", "10"]));
      expect(result.args.limit).toBe(10);
    });

    it("parses search with --limit 20", () => {
      const result = parseArgs(argv(["search", "./graph.db", "auth", "--limit", "20"]));
      expect(result.args.limit).toBe(20);
    });

    it("parses search with --type=route", () => {
      const result = parseArgs(argv(["search", "./graph.db", "auth", "--type=route"]));
      expect(result.args.type).toBe("route");
    });
  });

  describe("depth flag", () => {
    it("parses deps with --depth 3", () => {
      const result = parseArgs(argv(["deps", "./graph.db", "foo", "--depth", "3"]));
      expect(result.args.depth).toBe(3);
    });

    it("parses callers with --depth 2", () => {
      const result = parseArgs(argv(["callers", "./graph.db", "foo", "--depth", "2"]));
      expect(result.args.depth).toBe(2);
    });
  });

  describe("errors", () => {
    it("throws on unknown subcommand", () => {
      expect(() => parseArgs(argv(["foo"]))).toThrow("Unknown subcommand: foo");
    });

    it("throws on empty args", () => {
      expect(() => parseArgs(argv([]))).toThrow("Usage: build-graph <command> [options]");
    });
  });

  // ── explore CLI parse (A3 — Red Phase) ────────────────────────────────────

  describe("explore", () => {
    it("parses explore <db> <query>", () => {
      const result = parseArgs(argv(["explore", "./graph.db", "lesson"]));
      expect(result.subcommand).toBe("explore");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.query).toBe("lesson");
    });

    it("parses explore with --json", () => {
      const result = parseArgs(argv(["explore", "./graph.db", "lesson", "--json"]));
      expect(result.subcommand).toBe("explore");
      expect(result.args.json).toBe(true);
    });

    it("parses explore with --limit N", () => {
      const result = parseArgs(argv(["explore", "./graph.db", "lesson", "--limit", "5"]));
      expect(result.args.limit).toBe(5);
    });

    it("parses explore with --depth N", () => {
      const result = parseArgs(argv(["explore", "./graph.db", "lesson", "--depth", "2"]));
      expect(result.args.depth).toBe(2);
    });

    it("parses explore with --include-source", () => {
      const result = parseArgs(argv(["explore", "./graph.db", "lesson", "--include-source"]));
      expect(result.args.includeSource).toBe(true);
    });

    it("parses explore with all flags combined", () => {
      const result = parseArgs(argv(["explore", "./graph.db", "lesson", "--json", "--limit", "10", "--depth", "3", "--include-source"]));
      expect(result.subcommand).toBe("explore");
      expect(result.args.json).toBe(true);
      expect(result.args.limit).toBe(10);
      expect(result.args.depth).toBe(3);
      expect(result.args.includeSource).toBe(true);
    });

    it("throws on missing query", () => {
      expect(() => parseArgs(argv(["explore", "./graph.db"]))).toThrow();
    });
  });

  // ── affected CLI parse (A4 — Red Phase) ───────────────────────────────────

  describe("affected", () => {
    it("parses affected <db> <file...>", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "src/foo.ts"]));
      expect(result.subcommand).toBe("affected");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.files).toEqual(["src/foo.ts"]);
    });

    it("parses affected with multiple file arguments", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "src/a.ts", "src/b.ts"]));
      expect(result.args.files).toEqual(["src/a.ts", "src/b.ts"]);
    });

    it("parses affected with --stdin", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "--stdin"]));
      expect(result.args.stdin).toBe(true);
    });

    it("parses affected with --json", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "src/foo.ts", "--json"]));
      expect(result.args.json).toBe(true);
    });

    it("parses affected with --depth N", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "src/foo.ts", "--depth", "2"]));
      expect(result.args.depth).toBe(2);
    });

    it("parses affected with --tests-only", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "src/foo.ts", "--tests-only"]));
      expect(result.args.testsOnly).toBe(true);
    });

    it("parses affected with --filter <glob>", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "src/foo.ts", "--filter", "*.test.ts"]));
      expect(result.args.filter).toBe("*.test.ts");
    });

    it("parses affected with all flags combined", () => {
      const result = parseArgs(argv(["affected", "./graph.db", "src/a.ts", "--stdin", "--json", "--depth", "3", "--tests-only"]));
      expect(result.subcommand).toBe("affected");
      expect(result.args.json).toBe(true);
      expect(result.args.depth).toBe(3);
      expect(result.args.testsOnly).toBe(true);
      expect(result.args.stdin).toBe(true);
    });

    it("throws on missing db", () => {
      expect(() => parseArgs(argv(["affected"]))).toThrow();
    });
  });

  // ── impact CLI parse (A5 — Red Phase) ─────────────────────────────────────

  describe("impact", () => {
    it("parses impact <db> <node-or-file>", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "scienceLessons"]));
      expect(result.subcommand).toBe("impact");
      expect(result.args.dbPath).toBe("./graph.db");
      expect(result.args.nodeOrFile).toBe("scienceLessons");
    });

    it("parses impact with fully-qualified node ID", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "function:src/foo.ts:bar"]));
      expect(result.args.nodeOrFile).toBe("function:src/foo.ts:bar");
    });

    it("parses impact with exact file path", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "src/db/schema.ts"]));
      expect(result.args.nodeOrFile).toBe("src/db/schema.ts");
    });

    it("parses impact with --json", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "foo", "--json"]));
      expect(result.args.json).toBe(true);
    });

    it("parses impact with --depth N", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "foo", "--depth", "3"]));
      expect(result.args.depth).toBe(3);
    });

    it("parses impact with --edge-type", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "foo", "--edge-type", "imports"]));
      expect(result.args.edgeType).toBe("imports");
    });

    it("parses impact with --include-source", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "foo", "--include-source"]));
      expect(result.args.includeSource).toBe(true);
    });

    it("parses impact with all flags combined", () => {
      const result = parseArgs(argv(["impact", "./graph.db", "schema:scienceLessons", "--json", "--depth", "2", "--edge-type", "queries", "--include-source"]));
      expect(result.subcommand).toBe("impact");
      expect(result.args.json).toBe(true);
      expect(result.args.depth).toBe(2);
      expect(result.args.edgeType).toBe("queries");
      expect(result.args.includeSource).toBe(true);
    });

    it("throws on missing node-or-file", () => {
      expect(() => parseArgs(argv(["impact", "./graph.db"]))).toThrow();
    });
  });

  // ── Phase 2 Red — Git hook CLI wiring ─────────────────────────────────────

  describe("update with json flag", () => {
    it("C4: parses update with --json flag", () => {
      const result = parseArgs(argv(["update", "--json", "graph.db", "src/foo.ts"]));
      expect(result.subcommand).toBe("update");
      expect(result.args.json).toBe(true);
    });
  });

  describe("install-hooks", () => {
    it("C1: parses install-hooks subcommand", () => {
      const result = parseArgs(argv(["install-hooks"]));
      expect(result.subcommand).toBe("install-hooks");
      expect(result.args).toBeDefined();
    });

    it("C2: parses install-hooks with default path", () => {
      const result = parseArgs(argv(["install-hooks"]));
      expect(result.subcommand).toBe("install-hooks");
      expect(result.args.path).toBeUndefined();
    });

    it("C3: parses install-hooks with --path flag", () => {
      const result = parseArgs(argv(["install-hooks", "--path", "/custom/.git"]));
      expect(result.subcommand).toBe("install-hooks");
      expect(result.args.path).toBe("/custom/.git");
    });
  });
});
