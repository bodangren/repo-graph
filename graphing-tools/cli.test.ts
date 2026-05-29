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
});
