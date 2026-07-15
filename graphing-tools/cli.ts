import type { ParsedArgs, Subcommand } from "./contract";

function parseFlags(args: string[]): {
  flags: string[];
  json: boolean;
  limit?: number;
  depth?: number;
  fromPackage?: string;
  toPackage?: string;
  type?: string;
  configPath?: string;
  includePatterns?: string[];
  docs: boolean;
  includeInternal: boolean;
} {
  const flags: string[] = [];
  let json = false;
  let limit: number | undefined;
  let depth: number | undefined;
  let fromPackage: string | undefined;
  let toPackage: string | undefined;
  let type: string | undefined;
  let configPath: string | undefined;
  const includePatterns: string[] = [];
  let docs = false;
  let includeInternal = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json" || a === "-j") {
      json = true;
    } else if (a === "--limit" || a === "-l") {
      const next = args[++i];
      if (next === undefined) throw new Error("Usage: --limit requires a number");
      limit = Number(next);
    } else if (a === "--depth" || a === "-d") {
      const next = args[++i];
      if (next === undefined) throw new Error("Usage: --depth requires a number");
      depth = Number(next);
    } else if (a.startsWith("--from-package=")) {
      fromPackage = a.slice("--from-package=".length);
    } else if (a.startsWith("--to-package=")) {
      toPackage = a.slice("--to-package=".length);
    } else if (a.startsWith("--type=")) {
      type = a.slice("--type=".length);
    } else if (a === "--config") {
      const next = args[++i];
      if (next === undefined) throw new Error("Usage: --config requires a path");
      configPath = next;
    } else if (a.startsWith("--config=")) {
      configPath = a.slice("--config=".length);
    } else if (a === "--include") {
      const next = args[++i];
      if (next === undefined) throw new Error("Usage: --include requires a glob pattern");
      includePatterns.push(next);
    } else if (a.startsWith("--include=")) {
      includePatterns.push(a.slice("--include=".length));
    } else if (a === "--docs") {
      docs = true;
    } else if (a === "--include-internal") {
      includeInternal = true;
    } else {
      flags.push(a);
    }
  }

  return { flags, json, limit, depth, fromPackage, toPackage, type, configPath, includePatterns: includePatterns.length > 0 ? includePatterns : undefined, docs, includeInternal };
}

/**
 * Parse command-line arguments into the shared CLI contract.
 *
 * @param argv Process argument vector.
 * @returns Validated subcommand and arguments.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  if (args.length === 0) {
    throw new Error("Usage: repo-graph <command> [options]");
  }

  if (args[0] === "--help" || args[0] === "-h") {
    return { subcommand: "help", args: {} };
  }

  if (args[0] === "--version" || args[0] === "-v") {
    return { subcommand: "version", args: {} };
  }

  const subcommand = args[0] as Subcommand;

  if (args.slice(1).includes("--help") || args.slice(1).includes("-h")) {
    return { subcommand: "help", args: { subcommand } };
  }

  switch (subcommand) {
    case "init": {
      if (args.length < 2) throw new Error("Usage: repo-graph init <db>");
      return { subcommand: "init", args: { dbPath: args[1] } };
    }
    case "scan": {
      if (args.length < 3) throw new Error("Usage: repo-graph scan <project-dir> <db> [--config <path>] [--include <glob>]");
      const { configPath, includePatterns } = parseFlags(args.slice(3));
      return { subcommand: "scan", args: { projectDir: args[1], dbPath: args[2], configPath, includePatterns } };
    }
    case "update": {
      const json = args.slice(1).includes("--json") || args.slice(1).includes("-j");
      const positional = args.slice(1).filter((arg) => arg !== "--json" && arg !== "-j");
      if (positional.length < 1) throw new Error("Usage: repo-graph update <db> [<file> ...] [--json]");
      return {
        subcommand: "update",
        args: { dbPath: positional[0], filePaths: positional.slice(1), json },
      };
    }
    case "query": {
      let offset = 1;
      const json = args[offset] === "--json" || args[offset] === "-j";
      if (json) offset++;
      if (args.length < offset + 2) throw new Error("Usage: repo-graph query <db> <sql>");
      return { subcommand: "query", args: { dbPath: args[offset], sql: args[offset + 1], json } };
    }
    case "search": {
      const { flags, json, limit, type } = parseFlags(args.slice(1));
      if (flags.length < 2) throw new Error("Usage: repo-graph search <db> <keyword> [--json] [--limit N] [--type=T]");
      return { subcommand: "search", args: { dbPath: flags[0], keyword: flags[1], json, limit, type } };
    }
    case "deps": {
      const downstream = args.includes("--downstream");
      const filtered = args.filter((a) => a !== "--downstream");
      const { flags, json, limit, depth, fromPackage, toPackage } = parseFlags(filtered.slice(1));
      if (flags.length < 2) throw new Error("Usage: repo-graph deps <db> <node-name> [--downstream] [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]");
      return { subcommand: "deps", args: { dbPath: flags[0], name: flags[1], downstream, json, limit, depth, fromPackage, toPackage } };
    }
    case "callers": {
      const { flags, json, limit, depth, fromPackage, toPackage } = parseFlags(args.slice(1));
      if (flags.length < 2) throw new Error("Usage: repo-graph callers <db> <function-name> [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]");
      return { subcommand: "callers", args: { dbPath: flags[0], name: flags[1], json, limit, depth, fromPackage, toPackage } };
    }
    case "path": {
      const { flags, json } = parseFlags(args.slice(1));
      if (flags.length < 3) throw new Error("Usage: repo-graph path <db> <from> <to> [--json]");
      return { subcommand: "path", args: { dbPath: flags[0], from: flags[1], to: flags[2], json } };
    }
    case "stats": {
      const { flags, json } = parseFlags(args.slice(1));
      if (flags.length < 1) throw new Error("Usage: repo-graph stats <db> [--json]");
      return { subcommand: "stats", args: { dbPath: flags[0], json } };
    }
    case "files": {
      const { flags, json, limit } = parseFlags(args.slice(1));
      if (flags.length < 1) throw new Error("Usage: repo-graph files <db> [pattern] [--json] [--limit N]");
      return { subcommand: "files", args: { dbPath: flags[0], pattern: flags[1], json, limit } };
    }
    case "inspect": {
      const { flags, json } = parseFlags(args.slice(1));
      if (flags.length < 2) throw new Error("Usage: repo-graph inspect <db> <node-id-or-name> [--json]");
      return { subcommand: "inspect", args: { dbPath: flags[0], name: flags[1], json } };
    }
    case "audit": {
      const { flags, json, docs, includeInternal } = parseFlags(args.slice(1));
      if (flags.length < 1) throw new Error("Usage: repo-graph audit <db> [--json] [--docs] [--include-internal]");
      return { subcommand: "audit", args: { dbPath: flags[0], json, docs, includeInternal } };
    }
    case "explore": {
      const { flags, json, limit, depth } = parseFlags(args.slice(1));
      const includeSource = args.slice(1).includes("--include-source");
      if (flags.length < 2) throw new Error("Usage: repo-graph explore <db> <query> [--json] [--limit N] [--depth N] [--include-source]");
      return { subcommand: "explore", args: { dbPath: flags[0], query: flags[1], json, limit, depth, includeSource } };
    }
    case "affected": {
      const stdin = args.includes("--stdin");
      const testsOnly = args.includes("--tests-only");
      const filterIdx = args.indexOf("--filter");
      let filter: string | undefined;
      if (filterIdx >= 0 && filterIdx + 1 < args.length) filter = args[filterIdx + 1];
      const { flags, json, depth } = parseFlags(args.slice(1).filter((a, i, arr) => {
        if (a === "--stdin" || a === "--tests-only") return false;
        if (a === "--filter" || (i > 0 && arr[i - 1] === "--filter")) return false;
        return true;
      }));
      if (flags.length < 1) throw new Error("Usage: repo-graph affected <db> [file ...] [--stdin] [--json] [--depth N] [--tests-only] [--filter <glob>]");
      return { subcommand: "affected", args: { dbPath: flags[0], files: flags.slice(1), stdin, json, depth, testsOnly, filter } };
    }
    case "impact": {
      const { flags, json, depth, fromPackage, toPackage } = parseFlags(args.slice(1));
      const includeSource = args.slice(1).includes("--include-source");
      const edgeTypeIdx = args.indexOf("--edge-type");
      let edgeType: string | undefined;
      if (edgeTypeIdx >= 0 && edgeTypeIdx + 1 < args.length) edgeType = args[edgeTypeIdx + 1];
      if (flags.length < 2) throw new Error("Usage: repo-graph impact <db> <node-or-file> [--json] [--depth N] [--edge-type T] [--include-source] [--from-package=P] [--to-package=P]");
      return { subcommand: "impact", args: { dbPath: flags[0], nodeOrFile: flags[1], json, depth, edgeType, includeSource, fromPackage, toPackage } };
    }
    case "help": {
      return { subcommand: "help", args: { subcommand: args[1] as Subcommand | undefined } };
    }
    case "config": {
      return { subcommand: "config", args: {} };
    }
    case "install-hooks": {
      const pathIdx = args.indexOf("--path");
      let hookPath: string | undefined;
      if (pathIdx >= 0 && pathIdx + 1 < args.length) hookPath = args[pathIdx + 1];
      const force = args.includes("--force");
      const json = args.includes("--json") || args.includes("-j");
      return {
        subcommand: "install-hooks",
        args: { path: hookPath, force, json },
      };
    }
    case "version": {
      if (args.length !== 1) throw new Error("Usage: repo-graph version");
      return { subcommand: "version", args: {} };
    }
    default:
      throw new Error(`Unknown subcommand: ${subcommand}\nUsage: repo-graph <command> [options]`);
  }
}
