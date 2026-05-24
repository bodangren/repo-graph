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
      expect(result.subcommand).toBe("help");
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
