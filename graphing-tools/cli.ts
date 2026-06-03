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
    } else {
      flags.push(a);
    }
  }

  return { flags, json, limit, depth, fromPackage, toPackage, type, configPath, includePatterns: includePatterns.length > 0 ? includePatterns : undefined };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  if (args.length === 0) {
    throw new Error("Usage: build-graph <command> [options]");
  }

  if (args[0] === "--help" || args[0] === "-h") {
    return { subcommand: "help", args: {} };
  }

  if (args[0] === "--version" || args[0] === "-v") {
    return { subcommand: "version", args: {} };
  }

  const subcommand = args[0] as Subcommand;

  switch (subcommand) {
    case "init": {
      if (args.length < 2) throw new Error("Usage: build-graph init <db>");
      return { subcommand: "init", args: { dbPath: args[1] } };
    }
    case "scan": {
      if (args.length < 3) throw new Error("Usage: build-graph scan <project-dir> <db> [--config <path>] [--include <glob>]");
      const { configPath, includePatterns } = parseFlags(args.slice(3));
      return { subcommand: "scan", args: { projectDir: args[1], dbPath: args[2], configPath, includePatterns } };
    }
    case "update": {
      if (args.length < 3) throw new Error("Usage: build-graph update <db> <file> [<file> ...]");
      return { subcommand: "update", args: { dbPath: args[1], filePaths: args.slice(2) } };
    }
    case "query": {
      let offset = 1;
      const json = args[offset] === "--json" || args[offset] === "-j";
      if (json) offset++;
      if (args.length < offset + 2) throw new Error("Usage: build-graph query <db> <sql>");
      return { subcommand: "query", args: { dbPath: args[offset], sql: args[offset + 1], json } };
    }
    case "search": {
      const { flags, json, limit, type } = parseFlags(args.slice(1));
      if (flags.length < 2) throw new Error("Usage: build-graph search <db> <keyword> [--json] [--limit N] [--type=T]");
      return { subcommand: "search", args: { dbPath: flags[0], keyword: flags[1], json, limit, type } };
    }
    case "deps": {
      const downstream = args.includes("--downstream");
      const filtered = args.filter((a) => a !== "--downstream");
      const { flags, json, limit, depth, fromPackage, toPackage } = parseFlags(filtered.slice(1));
      if (flags.length < 2) throw new Error("Usage: build-graph deps <db> <node-name> [--downstream] [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]");
      return { subcommand: "deps", args: { dbPath: flags[0], name: flags[1], downstream, json, limit, depth, fromPackage, toPackage } };
    }
    case "callers": {
      const { flags, json, limit, depth, fromPackage, toPackage } = parseFlags(args.slice(1));
      if (flags.length < 2) throw new Error("Usage: build-graph callers <db> <function-name> [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]");
      return { subcommand: "callers", args: { dbPath: flags[0], name: flags[1], json, limit, depth, fromPackage, toPackage } };
    }
    case "path": {
      const { flags, json } = parseFlags(args.slice(1));
      if (flags.length < 3) throw new Error("Usage: build-graph path <db> <from> <to> [--json]");
      return { subcommand: "path", args: { dbPath: flags[0], from: flags[1], to: flags[2], json } };
    }
    case "stats": {
      const { flags, json } = parseFlags(args.slice(1));
      if (flags.length < 1) throw new Error("Usage: build-graph stats <db> [--json]");
      return { subcommand: "stats", args: { dbPath: flags[0], json } };
    }
    case "files": {
      const { flags, json, limit } = parseFlags(args.slice(1));
      if (flags.length < 1) throw new Error("Usage: build-graph files <db> [pattern] [--json] [--limit N]");
      return { subcommand: "files", args: { dbPath: flags[0], pattern: flags[1], json, limit } };
    }
    case "inspect": {
      const { flags, json } = parseFlags(args.slice(1));
      if (flags.length < 2) throw new Error("Usage: build-graph inspect <db> <node-id-or-name> [--json]");
      return { subcommand: "inspect", args: { dbPath: flags[0], name: flags[1], json } };
    }
    case "audit": {
      const { flags, json } = parseFlags(args.slice(1));
      if (flags.length < 1) throw new Error("Usage: build-graph audit <db> [--json]");
      return { subcommand: "audit", args: { dbPath: flags[0], json } };
    }
    case "help": {
      return { subcommand: "help", args: { subcommand: args[1] as Subcommand | undefined } };
    }
    case "config": {
      return { subcommand: "config", args: {} };
    }
    default:
      throw new Error(`Unknown subcommand: ${subcommand}\nUsage: build-graph <command> [options]`);
  }
}
