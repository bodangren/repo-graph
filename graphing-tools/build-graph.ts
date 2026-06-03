#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "./cli";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { scanProject } from "./scanner";
import { dirname, basename } from "path";
import { runQuery, formatTable, formatJson } from "./query";
import { searchNodes } from "./search";
import { updateFiles } from "./update";
import { runDeps, runCallers, runPath, runStats, runFiles, runInspect } from "./commands";
import { runAudit } from "./audit";
import { setMeta, getProjectRoot } from "./meta";
import { ExitCode, type BuildGraphConfig, type CustomEdgeDef } from "./contract";
import { loadConfig, applyCustomEdges } from "./config";
import { discoverIncludeFiles } from "./include";

const VERSION = "0.1.0";

function printHelp(subcommand?: string): void {
  if (subcommand === "scan") {
    console.log("Usage: build-graph scan <project-dir> <output.db> [--config <path>] [--include <glob>]");
    console.log("  Scan a TypeScript project and build a knowledge graph database.");
    console.log("  --config <path>     Path to build-graph.config.json (default: auto-discover in project root)");
    console.log("  --include <glob>    Additional glob pattern for non-TS files (repeatable)");
  } else if (subcommand === "config") {
    console.log("Config file: build-graph.config.json");
    console.log("");
    console.log("Schema:");
    console.log("  {");
    console.log("    \"customEdges\": [");
    console.log("      {");
    console.log("        \"type\": \"validates_with\",        // edge type name (snake_case)");
    console.log("        \"description\": \"Route validates...\", // optional");
    console.log("        \"sourceType\": \"route\",             // node type: file|function|class|interface|type_alias|schema|field|route|param");
    console.log("        \"targetType\": \"schema\",             // same list as sourceType");
    console.log("        \"pattern\": {");
    console.log("          \"targetName\": \"*Schema\"           // optional glob filter on target node name");
    console.log("        },");
    console.log("        \"scope\": \"same-file\"                // optional: same-file (default) | imported | all");
    console.log("      }");
    console.log("    ]");
    console.log("  }");
    console.log("");
    console.log("Scope modes:");
    console.log("  same-file  Only connect source/target nodes in the same file (default, safest)");
    console.log("  imported   Also connect to targets in files the source file imports");
    console.log("  all        Connect every matching pair (cartesian product, use with targetName filter)");
    console.log("");
    console.log("Route mode tags:");
    console.log("  export const mode = 'practice'  ->  route node gets tag 'mode:practice'");
    console.log("  Detected automatically during scan. No config needed.");
    console.log("");
    console.log("Example:");
    console.log("  build-graph scan ./ ./graph.db --config ./build-graph.config.json");
    console.log("  build-graph scan ./ ./graph.db --include 'supabase/seed/**/*.json'");
  } else if (subcommand === "update") {
    console.log("Usage: build-graph update <db> <file> [<file> ...]");
    console.log("  Incrementally update the graph for changed files.");
  } else if (subcommand === "query") {
    console.log("Usage: build-graph query [--json] <db> <sql>");
    console.log("  Execute a SQL query against the graph database.");
  } else if (subcommand === "search") {
    console.log("Usage: build-graph search <db> <keyword>");
    console.log("  Search for nodes by keyword.");
  } else if (subcommand === "deps") {
    console.log("Usage: build-graph deps <db> <node-name> [--downstream]");
    console.log("  Find nodes that depend on the target (--downstream for reverse).");
  } else if (subcommand === "callers") {
    console.log("Usage: build-graph callers <db> <function-name>");
    console.log("  Find functions/files that reference the target function.");
  } else if (subcommand === "path") {
    console.log("Usage: build-graph path <db> <from> <to>");
    console.log("  Trace shortest dependency path between two nodes.");
  } else if (subcommand === "stats") {
    console.log("Usage: build-graph stats <db>");
    console.log("  Print a summary dashboard of the codebase.");
  } else if (subcommand === "files") {
    console.log("Usage: build-graph files <db> [pattern]");
    console.log("  List files with entity counts.");
  } else if (subcommand === "init") {
    console.log("Usage: build-graph init <db>");
    console.log("  Create a new graph database with schema and indexes.");
  } else if (subcommand === "inspect") {
    console.log("Usage: build-graph inspect <db> <node-id-or-name> [--json]");
    console.log("  Show detailed information about a node and its relationships.");
  } else if (subcommand === "audit") {
    console.log("Usage: build-graph audit <db> [--json]");
    console.log("  Cross-reference the graph against source files to detect stale nodes,");
    console.log("  missing files, orphan edges, and duplicate nodes.");
  } else {
    console.log("build-graph — Knowledge graph builder for TypeScript codebases");
    console.log("");
    console.log("Usage: build-graph <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  init     <db>                         Create a new graph database");
    console.log("  scan     <project-dir> <db>           Scan a TypeScript project");
    console.log("  config                                 Show config file schema and examples");
    console.log("  update   <db> <file...>               Incrementally update changed files");
    console.log("  query    [--json] <db> <sql>          Run a SQL query");
    console.log("  search   <db> <keyword>               Search nodes by keyword");
    console.log("  deps     <db> <node> [--downstream]   Find dependents/dependencies");
    console.log("  callers  <db> <function>              Find function callers");
    console.log("  path     <db> <from> <to>             Trace dependency path");
    console.log("  stats    <db>                         Print codebase dashboard");
    console.log("  files    <db> [pattern]               List files with counts");
    console.log("  inspect  <db> <name> [--json]         Inspect a node and its relationships");
    console.log("  audit    <db> [--json]                Audit graph integrity against source");
    console.log("  help     [command]                    Show help for a command");
    console.log("");
    console.log("Options:");
    console.log("  --version, -v    Show version");
    console.log("  --help, -h       Show this help");
  }
}

async function handleInit(dbPath: string, projectDir?: string): Promise<void> {
  const db = new Database(dbPath);
  try {
    createSchema(db);
    createIndexes(db);
    if (projectDir) {
      setMeta(db, "project_root", resolve(projectDir));
    }
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

function getPackageIdForFile(filePath: string, tsConfigPaths: string[]): string {
  let best: string | undefined;
  let bestDepth = -1;
  const dir = dirname(filePath);
  for (const cfg of tsConfigPaths) {
    const cfgDir = dirname(cfg);
    if (dir === cfgDir || dir.startsWith(cfgDir + "/")) {
      const depth = cfgDir.split("/").length;
      if (depth > bestDepth) {
        best = cfg;
        bestDepth = depth;
      }
    }
  }
  if (best) {
    return basename(dirname(best));
  }
  return "root";
}

export async function createProject(projectDir: string): Promise<{ project: Project; tsConfigPaths: string[] }> {
  const rootConfig = join(projectDir, "tsconfig.json");

  // Fast path: single root tsconfig
  try {
    if (statSync(rootConfig).isFile()) {
      const project = new Project({ tsConfigFilePath: rootConfig });
      if (project.getSourceFiles().length > 0) {
        return { project, tsConfigPaths: [rootConfig] };
      }
      // Fall through to glob fallback if tsconfig include is empty
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
    if (project.getSourceFiles().length > 0) {
      return { project, tsConfigPaths: configs };
    }
    // Fall through to glob fallback if no tsconfig includes files
  }

  // Fallback: glob all .ts/.tsx files
  const project = new Project();
  project.addSourceFilesAtPaths(join(projectDir, "**/*.ts"));
  project.addSourceFilesAtPaths(join(projectDir, "**/*.tsx"));
  // Remove files inside skipped directories that glob may have picked up
  for (const sf of [...project.getSourceFiles()]) {
    const fp = sf.getFilePath();
    for (const skip of SKIP_DIRS) {
      if (fp.includes(`/${skip}/`)) {
        project.removeSourceFile(sf);
        break;
      }
    }
  }
  return { project, tsConfigPaths: [] };
}

async function handleScan(projectDir: string, dbPath: string, configPath?: string, includePatterns?: string[]): Promise<void> {
  const start = performance.now();
  const db = new Database(dbPath);
  const absProjectDir = resolve(projectDir);

  try {
    createSchema(db);
    createIndexes(db);
    setMeta(db, "project_root", absProjectDir);

    const { project, tsConfigPaths } = await createProject(absProjectDir);
    const packageMap = new Map<string, string>();
    for (const sf of project.getSourceFiles()) {
      const fp = sf.getFilePath();
      packageMap.set(fp, getPackageIdForFile(fp, tsConfigPaths));
    }
    const { nodes, edges } = scanProject(project, packageMap);

    // Load config and apply custom edges
    const config = loadConfig(absProjectDir, configPath);
    if (config?.customEdges) {
      const importEdges = edges.filter((e) => e.type === "imports");
      const customEdges = applyCustomEdges(nodes, config.customEdges, importEdges);
      edges.push(...customEdges);
      console.error(`Applied ${customEdges.length} custom edge(s) from config`);
    }

    // Discover include pattern files (non-TS)
    if (includePatterns && includePatterns.length > 0) {
      const includeFiles = discoverIncludeFiles(absProjectDir, includePatterns);
      const existingIds = new Set(nodes.map((n) => n.id));
      let added = 0;
      for (const filePath of includeFiles) {
        const nodeId = `file:${filePath}`;
        if (!existingIds.has(nodeId)) {
          nodes.push({
            id: nodeId,
            type: "file",
            name: filePath.split("/").pop()!,
            filePath,
            lineStart: 1,
            lineEnd: 1,
          });
          existingIds.add(nodeId);
          added++;
        }
      }
      console.error(`Included ${added} file(s) from --include patterns`);
    }

    const insertNode = db.prepare(`
      INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags, complexity, layer_id, package_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertEdge = db.prepare(`
      INSERT INTO edges (source, target, type, direction, weight, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const seenNodes = new Set<string>();
    const skippedNodes: string[] = [];

    db.transaction(() => {
      for (const n of nodes) {
        if (seenNodes.has(n.id)) {
          skippedNodes.push(n.id);
          continue;
        }
        seenNodes.add(n.id);
        insertNode.run(
          n.id, n.type, n.name, n.filePath,
          n.lineStart ?? null, n.lineEnd ?? null,
          n.summary ?? null,
          n.tags ? JSON.stringify(n.tags) : null,
          n.complexity ?? null,
          n.layerId ?? null,
          n.packageId ?? null
        );
      }
      for (const e of edges) {
        insertEdge.run(e.source, e.target, e.type, e.direction, e.weight ?? 0.5, e.metadata ?? null);
      }
    })();

    if (skippedNodes.length > 0) {
      console.error(`Warning: skipped ${skippedNodes.length} duplicate node(s): ${skippedNodes.slice(0, 5).join(", ")}${skippedNodes.length > 5 ? "..." : ""}`);
    }

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

async function handleSearch(dbPath: string, keyword: string, json: boolean, limit?: number, typeFilter?: string): Promise<void> {
  const db = new Database(dbPath);
  try {
    let results = searchNodes(db, keyword, typeFilter);
    if (limit !== undefined && limit > 0 && results.length > limit) {
      results = results.slice(0, limit);
    }
    if (json) {
      console.log(JSON.stringify(results));
      return;
    }
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
    const projectRoot = getProjectRoot(db) ?? ".";
    const { project } = await createProject(projectRoot);
    const stats = updateFiles(db, project, filePaths);
    console.error(`Updated ${stats.filesUpdated} files (${stats.nodesDeleted} → ${stats.nodesInserted} nodes, ${stats.edgesDeleted} → ${stats.edgesInserted} edges)`);
  } finally {
    db.close();
  }
}

async function handleDeps(dbPath: string, name: string, downstream: boolean, json: boolean, limit?: number, depth?: number, fromPackage?: string, toPackage?: string): Promise<number> {
  const db = new Database(dbPath);
  try {
    const { output, exitCode } = runDeps(db, name, downstream, { json, limit, depth, fromPackage, toPackage });
    if (output) console.log(output);
    return exitCode;
  } finally {
    db.close();
  }
}

async function handleCallers(dbPath: string, name: string, json: boolean, limit?: number, depth?: number, fromPackage?: string, toPackage?: string): Promise<number> {
  const db = new Database(dbPath);
  try {
    const { output, exitCode } = runCallers(db, name, { json, limit, depth, fromPackage, toPackage });
    if (output) console.log(output);
    return exitCode;
  } finally {
    db.close();
  }
}

async function handlePath(dbPath: string, from: string, to: string, json: boolean): Promise<number> {
  const db = new Database(dbPath);
  try {
    const { output, exitCode } = runPath(db, from, to, { json });
    if (output) console.log(output);
    return exitCode;
  } finally {
    db.close();
  }
}

async function handleStats(dbPath: string, json: boolean): Promise<void> {
  const db = new Database(dbPath);
  try {
    console.log(runStats(db, { json }));
  } finally {
    db.close();
  }
}

async function handleFiles(dbPath: string, pattern: string | undefined, json: boolean, limit?: number): Promise<void> {
  const db = new Database(dbPath);
  try {
    console.log(runFiles(db, pattern, { json, limit }));
  } finally {
    db.close();
  }
}

async function handleInspect(dbPath: string, name: string, json: boolean): Promise<number> {
  const db = new Database(dbPath);
  try {
    const { output, exitCode } = runInspect(db, name, { json });
    if (output) console.log(output);
    return exitCode;
  } finally {
    db.close();
  }
}

async function handleAudit(dbPath: string, json: boolean): Promise<number> {
  const db = new Database(dbPath);
  try {
    const { output, exitCode } = runAudit(db, { json });
    if (output) console.log(output);
    return exitCode;
  } finally {
    db.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  switch (parsed.subcommand) {
    case "init":
      await handleInit(parsed.args.dbPath);
      break;
    case "scan":
      await handleScan(parsed.args.projectDir, parsed.args.dbPath, parsed.args.configPath, parsed.args.includePatterns);
      break;
    case "query":
      await handleQuery(parsed.args.dbPath, parsed.args.sql, parsed.args.json ?? false);
      break;
    case "search":
      await handleSearch(parsed.args.dbPath, parsed.args.keyword, parsed.args.json ?? false, parsed.args.limit, parsed.args.type);
      break;
    case "update":
      await handleUpdate(parsed.args.dbPath, parsed.args.filePaths);
      break;
    case "deps":
      return await handleDeps(parsed.args.dbPath, parsed.args.name, parsed.args.downstream, parsed.args.json ?? false, parsed.args.limit, parsed.args.depth, parsed.args.fromPackage, parsed.args.toPackage);
    case "callers":
      return await handleCallers(parsed.args.dbPath, parsed.args.name, parsed.args.json ?? false, parsed.args.limit, parsed.args.depth, parsed.args.fromPackage, parsed.args.toPackage);
    case "path":
      return await handlePath(parsed.args.dbPath, parsed.args.from, parsed.args.to, parsed.args.json ?? false);
    case "stats":
      await handleStats(parsed.args.dbPath, parsed.args.json ?? false);
      break;
    case "files":
      await handleFiles(parsed.args.dbPath, parsed.args.pattern, parsed.args.json ?? false, parsed.args.limit);
      break;
    case "inspect":
      return await handleInspect(parsed.args.dbPath, parsed.args.name, parsed.args.json ?? false);
    case "audit":
      return await handleAudit(parsed.args.dbPath, parsed.args.json ?? false);
    case "help":
      printHelp(parsed.args.subcommand);
      break;
    case "config":
      printHelp("config");
      break;
    case "version":
      console.log(VERSION);
      break;
  }

  return ExitCode.Success;
}

if (import.meta.main) {
  main(process.argv).then((code) => process.exit(code)).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(message.startsWith("Usage") ? ExitCode.Misuse : ExitCode.RuntimeError);
  });
}
