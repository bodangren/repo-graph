#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { readdirSync, statSync } from "fs";
import { join } from "path";
import { parseArgs } from "./cli";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { scanProject } from "./scanner";
import { runQuery, formatTable, formatJson } from "./query";
import { searchNodes } from "./search";
import { updateFiles } from "./update";
import { ExitCode } from "./contract";

const VERSION = "0.1.0";

function printHelp(subcommand?: string): void {
  if (subcommand === "scan") {
    console.log("Usage: build-graph scan <project-dir> <output.db>");
    console.log("  Scan a TypeScript project and build a knowledge graph database.");
  } else if (subcommand === "update") {
    console.log("Usage: build-graph update <db> <file> [<file> ...]");
    console.log("  Incrementally update the graph for changed files.");
  } else if (subcommand === "query") {
    console.log("Usage: build-graph query [--json] <db> <sql>");
    console.log("  Execute a SQL query against the graph database.");
  } else if (subcommand === "search") {
    console.log("Usage: build-graph search <db> <keyword>");
    console.log("  Search for nodes by keyword.");
  } else if (subcommand === "init") {
    console.log("Usage: build-graph init <db>");
    console.log("  Create a new graph database with schema and indexes.");
  } else {
    console.log("build-graph — Knowledge graph builder for TypeScript codebases");
    console.log("");
    console.log("Usage: build-graph <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  init    <db>                 Create a new graph database");
    console.log("  scan    <project-dir> <db>   Scan a TypeScript project");
    console.log("  update  <db> <file...>       Incrementally update changed files");
    console.log("  query   [--json] <db> <sql>  Run a SQL query");
    console.log("  search  <db> <keyword>       Search nodes by keyword");
    console.log("  help    [command]            Show help for a command");
    console.log("");
    console.log("Options:");
    console.log("  --version, -v    Show version");
    console.log("  --help, -h       Show this help");
  }
}

async function handleInit(dbPath: string): Promise<void> {
  const db = new Database(dbPath);
  try {
    createSchema(db);
    createIndexes(db);
    console.error(`Initialized ${dbPath}`);
  } finally {
    db.close();
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "out", "coverage"]);

function discoverTsConfigs(root: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "tsconfig.json") {
        results.push(full);
      }
    }
  }

  walk(root);
  return results;
}

export async function createProject(projectDir: string): Promise<Project> {
  const rootConfig = join(projectDir, "tsconfig.json");

  // Fast path: single root tsconfig
  try {
    if (statSync(rootConfig).isFile()) {
      return new Project({ tsConfigFilePath: rootConfig });
    }
  } catch { /* no root tsconfig */ }

  // Discover all tsconfigs
  const configs = discoverTsConfigs(projectDir);

  if (configs.length > 0) {
    const project = new Project();
    for (const cfg of configs) {
      try {
        project.addSourceFilesFromTsConfig(cfg);
      } catch (err) {
        console.error(`Warning: could not load ${cfg}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return project;
  }

  // Fallback: glob all .ts/.tsx files
  const project = new Project();
  project.addSourceFilesAtPaths(join(projectDir, "**/*.ts"));
  project.addSourceFilesAtPaths(join(projectDir, "**/*.tsx"));
  return project;
}

async function handleScan(projectDir: string, dbPath: string): Promise<void> {
  const start = performance.now();
  const db = new Database(dbPath);

  try {
    createSchema(db);
    createIndexes(db);

    const project = await createProject(projectDir);
    const { nodes, edges } = scanProject(project);

    const insertNode = db.prepare(`
      INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags, layer_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEdge = db.prepare(`
      INSERT INTO edges (source, target, type, direction, weight)
      VALUES (?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      for (const n of nodes) {
        insertNode.run(
          n.id, n.type, n.name, n.filePath,
          n.lineStart ?? null, n.lineEnd ?? null,
          n.summary ?? null,
          n.tags ? JSON.stringify(n.tags) : null,
          n.layerId ?? null
        );
      }
      for (const e of edges) {
        insertEdge.run(e.source, e.target, e.type, e.direction, e.weight ?? 0.5);
      }
    })();

    const elapsed = Math.round(performance.now() - start);
    console.error(`Scanned ${nodes.length} nodes, ${edges.length} edges in ${elapsed}ms`);
  } finally {
    db.close();
  }
}

async function handleQuery(dbPath: string, sql: string, json: boolean): Promise<void> {
  const db = new Database(dbPath);
  try {
    const { columns, rows } = runQuery(db, sql);
    if (json) {
      console.log(formatJson(columns, rows));
    } else {
      console.log(formatTable(columns, rows));
    }
  } finally {
    db.close();
  }
}

async function handleSearch(dbPath: string, keyword: string): Promise<void> {
  const db = new Database(dbPath);
  try {
    const results = searchNodes(db, keyword);
    if (results.length === 0) {
      console.log("(no results)");
      return;
    }
    const columns = ["type", "name", "file_path", "summary"];
    const rows = results.map((r) => [r.type, r.name, r.filePath, r.summary ?? null]);
    console.log(formatTable(columns, rows));
  } finally {
    db.close();
  }
}

async function handleUpdate(dbPath: string, filePaths: string[]): Promise<void> {
  const db = new Database(dbPath);
  try {
    const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
    const stats = updateFiles(db, project, filePaths);
    console.error(`Updated ${stats.filesUpdated} files (${stats.nodesDeleted} → ${stats.nodesInserted} nodes, ${stats.edgesDeleted} → ${stats.edgesInserted} edges)`);
  } finally {
    db.close();
  }
}

export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  switch (parsed.subcommand) {
    case "init":
      await handleInit(parsed.args.dbPath);
      break;
    case "scan":
      await handleScan(parsed.args.projectDir, parsed.args.dbPath);
      break;
    case "query":
      await handleQuery(parsed.args.dbPath, parsed.args.sql, parsed.args.json ?? false);
      break;
    case "search":
      await handleSearch(parsed.args.dbPath, parsed.args.keyword);
      break;
    case "update":
      await handleUpdate(parsed.args.dbPath, parsed.args.filePaths);
      break;
    case "help":
      printHelp(parsed.args.subcommand);
      break;
  }
}

if (import.meta.main) {
  main(process.argv).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(message.startsWith("Usage") ? ExitCode.Misuse : ExitCode.RuntimeError);
  });
}
