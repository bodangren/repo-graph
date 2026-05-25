import type { ParsedArgs, Subcommand } from "./contract";

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  if (args.length === 0) {
    throw new Error("Usage: build-graph <command> [options]");
  }

  if (args[0] === "--help" || args[0] === "-h") {
    return { subcommand: "help", args: {} };
  }

  if (args[0] === "--version" || args[0] === "-v") {
    return { subcommand: "help", args: {} };
  }

  const subcommand = args[0] as Subcommand;

  switch (subcommand) {
    case "init": {
      if (args.length < 2) throw new Error("Usage: build-graph init <db>");
      return { subcommand: "init", args: { dbPath: args[1] } };
    }
    case "scan": {
      if (args.length < 3) throw new Error("Usage: build-graph scan <project-dir> <db>");
      return { subcommand: "scan", args: { projectDir: args[1], dbPath: args[2] } };
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
      if (args.length < 3) throw new Error("Usage: build-graph search <db> <keyword>");
      return { subcommand: "search", args: { dbPath: args[1], keyword: args[2] } };
    }
    case "deps": {
      const downstream = args.includes("--downstream");
      const filtered = args.filter((a) => a !== "--downstream");
      if (filtered.length < 3) throw new Error("Usage: build-graph deps <db> <node-name> [--downstream]");
      return { subcommand: "deps", args: { dbPath: filtered[1], name: filtered[2], downstream } };
    }
    case "callers": {
      if (args.length < 3) throw new Error("Usage: build-graph callers <db> <function-name>");
      return { subcommand: "callers", args: { dbPath: args[1], name: args[2] } };
    }
    case "path": {
      if (args.length < 4) throw new Error("Usage: build-graph path <db> <from> <to>");
      return { subcommand: "path", args: { dbPath: args[1], from: args[2], to: args[3] } };
    }
    case "stats": {
      if (args.length < 2) throw new Error("Usage: build-graph stats <db>");
      return { subcommand: "stats", args: { dbPath: args[1] } };
    }
    case "files": {
      if (args.length < 2) throw new Error("Usage: build-graph files <db> [pattern]");
      return { subcommand: "files", args: { dbPath: args[1], pattern: args[2] } };
    }
    case "help": {
      return { subcommand: "help", args: { subcommand: args[1] as Subcommand | undefined } };
    }
    default:
      throw new Error(`Unknown subcommand: ${subcommand}\nUsage: build-graph <command> [options]`);
  }
}
