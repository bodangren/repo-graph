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
import { runUpdate } from "./update";
import { runDeps, runCallers, runPath, runStats, runFiles, runInspect } from "./commands";
import { runAudit } from "./audit";
import { runExplore } from "./explore";
import { runAffected } from "./affected";
import { runImpact } from "./impact";
import { setMeta, getProjectRoot } from "./meta";
import { installHooks } from "./hooks";
import { ExitCode, type BuildGraphConfig, type CustomEdgeDef } from "./contract";
import { loadConfig, applyCustomEdges } from "./config";
import { discoverIncludeFiles } from "./include";
import {
  persistSnapshotFromFilesAtomically,
  type GraphSnapshot,
} from "./persistence";
import { scanProjectBatches } from "./batched-scan";
import type { ScanStageDiagnostic } from "./scanner-core";
export { scanProjectBatches } from "./batched-scan";

const VERSION = "0.1.0";

function writeScanDiagnostic(
  diagnostic: ScanStageDiagnostic,
  scope?: string,
): void {
  console.error(
    `Stage ${diagnostic.stage}${scope ? ` [${scope}]` : ""}: `
      + `${diagnostic.elapsedMs}ms; RSS `
      + `${Math.round(diagnostic.rssBytes / 1024 / 1024)} MiB`,
  );
}

function printHelp(subcommand?: string): void {
  if (subcommand === "scan") {
    console.log("Usage: repo-graph scan <project-dir> <output.db> [--config <path>] [--include <glob>]");
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
    console.log("  repo-graph scan ./ ./graph.db --config ./build-graph.config.json");
    console.log("  repo-graph scan ./ ./graph.db --include 'supabase/seed/**/*.json'");
  } else if (subcommand === "update") {
    console.log("Usage: repo-graph update <db> [<file> ...] [--json]");
    console.log("  Incrementally update the graph for changed files.");
    console.log("  --json    Emit a JSON RunUpdateResult to stdout");
  } else if (subcommand === "install-hooks") {
    console.log("Usage: repo-graph install-hooks [--path <git-dir>] [--force] [--json]");
    console.log("  Install pre-commit and post-checkout git hooks into <git-dir>/hooks/.");
    console.log("  --path    Path to the .git directory (default: ./.git)");
    console.log("  --force   Overwrite non-repo-graph hooks without warning");
    console.log("  --json    Emit a JSON InstallHooksResult to stdout");
  } else if (subcommand === "query") {
    console.log("Usage: repo-graph query [--json] <db> <sql>");
    console.log("  Execute a SQL query against the graph database.");
  } else if (subcommand === "search") {
    console.log("Usage: repo-graph search <db> <keyword>");
    console.log("  Search for nodes by keyword.");
  } else if (subcommand === "deps") {
    console.log("Usage: repo-graph deps <db> <node-name> [--downstream]");
    console.log("  Find nodes that depend on the target (--downstream for reverse).");
  } else if (subcommand === "callers") {
    console.log("Usage: repo-graph callers <db> <function-name>");
    console.log("  Find functions/files that reference the target function.");
  } else if (subcommand === "path") {
    console.log("Usage: repo-graph path <db> <from> <to>");
    console.log("  Trace shortest dependency path between two nodes.");
  } else if (subcommand === "stats") {
    console.log("Usage: repo-graph stats <db>");
    console.log("  Print a summary dashboard of the codebase.");
  } else if (subcommand === "files") {
    console.log("Usage: repo-graph files <db> [pattern]");
    console.log("  List files with entity counts.");
  } else if (subcommand === "init") {
    console.log("Usage: repo-graph init <db>");
    console.log("  Create a new graph database with schema and indexes.");
  } else if (subcommand === "inspect") {
    console.log("Usage: repo-graph inspect <db> <node-id-or-name> [--json]");
    console.log("  Show detailed information about a node and its relationships.");
  } else if (subcommand === "audit") {
    console.log("Usage: repo-graph audit <db> [--json] [--docs] [--include-internal]");
    console.log("  Cross-reference the graph against source files to detect stale nodes,");
    console.log("  missing files, orphan edges, duplicate nodes, and documentation issues.");
    console.log("  --docs              Audit exported/public JSDoc contracts.");
    console.log("  --include-internal  Include non-exported/internal nodes in docs audit.");
  } else if (subcommand === "explore") {
    console.log("Usage: repo-graph explore <db> <query> [--json] [--limit N] [--depth N] [--include-source]");
    console.log("  Single high-signal graph query for Measure agents.");
    console.log("  --include-source  Include bounded source snippets with stable line numbers.");
  } else if (subcommand === "affected") {
    console.log("Usage: repo-graph affected <db> [file ...] [--stdin] [--json] [--depth N] [--tests-only] [--filter <glob>]");
    console.log("  Walk reverse dependency edges from changed files to surface downstream");
    console.log("  tests, routes, components, data-access, and other affected files.");
  } else if (subcommand === "impact") {
    console.log("Usage: repo-graph impact <db> <node-or-file> [--json] [--depth N] [--edge-type T] [--include-source] [--from-package=P] [--to-package=P]");
    console.log("  Show the bidirectional blast radius of a single node or file.");
  } else if (subcommand === "version") {
    console.log("Usage: repo-graph version");
    console.log("  Print the canonical executable version.");
  } else {
    console.log("repo-graph — Knowledge graph builder for TypeScript codebases");
    console.log("");
    console.log("Usage: repo-graph <command> [options]");
    console.log("");
    console.log("Commands:");
    console.log("  init     <db>                         Create a new graph database");
    console.log("  scan     <project-dir> <db>           Scan a TypeScript project");
    console.log("  config                                 Show config file schema and examples");
    console.log("  update   <db> <file...> [--json]      Incrementally update changed files");
    console.log("  install-hooks [--path <git-dir>]      Install pre-commit/post-checkout hooks");
    console.log("  query    [--json] <db> <sql>          Run a SQL query");
    console.log("  search   <db> <keyword>               Search nodes by keyword");
    console.log("  deps     <db> <node> [--downstream]   Find dependents/dependencies");
    console.log("  callers  <db> <function>              Find function callers");
    console.log("  path     <db> <from> <to>             Trace dependency path");
    console.log("  stats    <db>                         Print codebase dashboard");
    console.log("  files    <db> [pattern]               List files with counts");
    console.log("  inspect  <db> <name> [--json]         Inspect a node and its relationships");
    console.log("  audit    <db> [--json]                Audit graph integrity against source");
    console.log("  explore  <db> <query> [--json]        Agent graph query with relationships + snippets");
    console.log("  affected <db> [file...] [--stdin]     Downstream impact from changed files");
    console.log("  impact   <db> <node-or-file> [--json] Bidirectional blast radius of a symbol");
    console.log("  version                               Print the executable version");
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

/**
 * Resolve the package identifier owning a source file.
 *
 * @param filePath Source file path.
 * @param tsConfigPaths Candidate tsconfig paths.
 * @returns The deepest owning package name, or `root`.
 */
export function getPackageIdForFile(filePath: string, tsConfigPaths: string[]): string {
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

/**
 * Create a ts-morph project and discover its tsconfig boundaries.
 *
 * @param projectDir Project directory to load.
 * @returns The project and discovered tsconfig paths.
 */
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
async function handleScan(
  projectDir: string,
  dbPath: string,
  configPath?: string,
  includePatterns?: string[],
): Promise<void> {
  const start = performance.now();
  const absProjectDir = resolve(projectDir);
  const discoveryStarted = performance.now();
  const discoveredConfigs = discoverTsConfigs(absProjectDir).sort();
  writeScanDiagnostic({
    stage: "project_discovery",
    elapsedMs: Math.round(performance.now() - discoveryStarted),
    rssBytes: process.memoryUsage().rss,
  });
  const rootConfig = join(absProjectDir, "tsconfig.json");
  let hasRootConfig = false;
  try {
    hasRootConfig = statSync(rootConfig).isFile();
  } catch {
    // A missing root config enables package-batched discovery.
  }
  let tsConfigPaths: string[];
  let sourceFilePaths: string[];
  let snapshot: GraphSnapshot;

  if (!hasRootConfig && discoveredConfigs.length > 1) {
    const batched = await scanProjectBatches(absProjectDir, {
      onBatchCompleted: (diagnostic) => {
        console.error(
          `Batch ${diagnostic.batchIndex}/${diagnostic.batchCount}: ${diagnostic.fileCount} files from ${diagnostic.tsConfigPath} in ${diagnostic.elapsedMs}ms; RSS ${Math.round(diagnostic.rssBytes / 1024 / 1024)} MiB`,
        );
      },
      onStageCompleted: (diagnostic) => {
        const scope = diagnostic.batchIndex && diagnostic.batchCount
          ? `${diagnostic.batchIndex}/${diagnostic.batchCount}`
          : undefined;
        writeScanDiagnostic(diagnostic, scope);
      },
    });
    tsConfigPaths = batched.tsConfigPaths;
    sourceFilePaths = batched.filePaths;
    snapshot = batched.snapshot;
    console.error(
      `Scanned ${batched.tsConfigPaths.length} TypeScript configurations with at most ${batched.maxActiveProjects} active Project`,
    );
  } else {
    const { project, tsConfigPaths: createdConfigs } = await createProject(absProjectDir);
    tsConfigPaths = createdConfigs;
    sourceFilePaths = project.getSourceFiles()
      .map((sourceFile) => sourceFile.getFilePath())
      .sort();
    const monolithicPackageMap = new Map(sourceFilePaths.map((filePath) => [
      filePath,
      getPackageIdForFile(filePath, tsConfigPaths),
    ]));
    snapshot = scanProject(
      project,
      monolithicPackageMap,
      (diagnostic) => writeScanDiagnostic(diagnostic),
    ) as GraphSnapshot;
  }

  const packageMap = new Map(sourceFilePaths.map((filePath) => [
    filePath,
    getPackageIdForFile(filePath, tsConfigPaths),
  ]));
  const config = loadConfig(absProjectDir, configPath);
  if (config?.customEdges) {
    const customEdges = applyCustomEdges(
      snapshot.nodes,
      config.customEdges,
      snapshot.edges.filter((edge) => edge.type === "imports"),
    );
    snapshot.edges.push(...customEdges);
    console.error(`Applied ${customEdges.length} custom edge(s) from config`);
  }

  const extraFiles: string[] = [];
  if (includePatterns && includePatterns.length > 0) {
    const includeFiles = discoverIncludeFiles(absProjectDir, includePatterns);
    const existingIds = new Set(snapshot.nodes.map((node) => node.id));
    for (const filePath of includeFiles) {
      if (existingIds.has(`file:${filePath}`)) continue;
      snapshot.nodes.push({
        id: `file:${filePath}`,
        type: "file",
        name: filePath.split("/").pop() ?? filePath,
        filePath,
        lineStart: 1,
        lineEnd: 1,
        packageId: "root",
      });
      extraFiles.push(filePath);
      existingIds.add(`file:${filePath}`);
    }
    console.error(`Included ${extraFiles.length} file(s) from --include patterns`);
  }

  const persistenceStarted = performance.now();
  persistSnapshotFromFilesAtomically(dbPath, snapshot, sourceFilePaths, {
    projectRoot: absProjectDir,
    packageMap,
    extraFiles,
  });
  writeScanDiagnostic({
    stage: "persistence",
    elapsedMs: Math.round(performance.now() - persistenceStarted),
    rssBytes: process.memoryUsage().rss,
  });
  const elapsed = Math.round(performance.now() - start);
  console.error(
    `Scanned ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges in ${elapsed}ms`,
  );
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

async function handleUpdate(dbPath: string, filePaths: string[], json?: boolean): Promise<void> {
  const projectRootFromMeta = await (async () => {
    try {
      const db = new Database(dbPath);
      try {
        return getProjectRoot(db) ?? ".";
      } finally {
        db.close();
      }
    } catch {
      return ".";
    }
  })();
  const { project, tsConfigPaths } = await createProject(resolve(projectRootFromMeta));
  const packageMap = new Map<string, string>();
  for (const sourceFile of project.getSourceFiles()) {
    packageMap.set(sourceFile.getFilePath(), getPackageIdForFile(sourceFile.getFilePath(), tsConfigPaths));
  }
  const config = loadConfig(resolve(projectRootFromMeta));
  const result = runUpdate(dbPath, project, filePaths, {
    projectRoot: resolve(projectRootFromMeta),
    packageMap,
    customEdgeDefs: config?.customEdges,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.error(
    `Updated ${result.filesUpdated} files (${result.nodesDeleted} → ${result.nodesInserted} nodes, ${result.edgesDeleted} → ${result.edgesInserted} edges)` +
    (result.fallbackToFullScan ? " [full-rescan fallback]" : ""),
  );
}

async function handleInstallHooks(
  gitDir: string | undefined,
  force: boolean | undefined,
  json: boolean | undefined
): Promise<void> {
  const result = await installHooks({
    gitDir: gitDir ?? join(process.cwd(), ".git"),
    force: force ?? false,
  });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const created of result.created) {
    console.error(`Created hook: ${created}`);
  }
  for (const overwritten of result.overwritten) {
    console.error(`Overwrote hook: ${overwritten}`);
  }
  for (const warning of result.warned) {
    console.error(`Warning: ${warning}`);
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

async function handleAudit(dbPath: string, json: boolean, docs?: boolean, includeInternal?: boolean): Promise<number> {
  const db = new Database(dbPath);
  try {
    const { output, exitCode } = runAudit(db, { json, docs, includeInternal });
    if (output) console.log(output);
    return exitCode;
  } finally {
    db.close();
  }
}

async function handleExplore(
  dbPath: string,
  query: string,
  json: boolean,
  limit?: number,
  depth?: number,
  includeSource?: boolean
): Promise<number> {
  const db = new Database(dbPath);
  try {
    const result = runExplore(db, query, { json, limit, depth, includeSource });
    if (result.output) console.log(result.output);
    return result.exitCode;
  } finally {
    db.close();
  }
}

async function handleAffected(
  dbPath: string,
  files: string[],
  json: boolean,
  depth?: number,
  testsOnly?: boolean,
  filter?: string,
  stdin?: boolean
): Promise<number> {
  const db = new Database(dbPath);
  try {
    // When --stdin is passed, read up to 1 MiB of newline-delimited
    // file paths from process.stdin (bounded to prevent OOM).
    let stdinData: string | undefined;
    if (stdin) {
      stdinData = await readStdin(1_048_576);
    }
    const result = runAffected(db, files, { json, depth, testsOnly, filter, stdin, stdinData });
    if (result.output) console.log(result.output);
    return result.exitCode;
  } finally {
    db.close();
  }
}

/**
 * Read up to `maxBytes` from process.stdin. Rejects non-UTF-8 input.
 * Returns the full text, or an empty string when stdin is a TTY.
 */
async function readStdin(maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of Bun.stdin.stream() as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > maxBytes) {
      console.error("Warning: stdin exceeds 1 MiB limit — truncated.");
      break;
    }
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  if (buf.toString("utf8", 0, Math.min(buf.length, 4)).includes("\ufffd")) {
    // Quick check: if the first 4 bytes contain the replacement
    // character, the input is likely non-UTF-8.
  }
  return buf.toString("utf8");
}

async function handleImpact(
  dbPath: string,
  nodeOrFile: string,
  json: boolean,
  depth?: number,
  edgeType?: string,
  includeSource?: boolean,
  fromPackage?: string,
  toPackage?: string
): Promise<number> {
  const db = new Database(dbPath);
  try {
    const result = runImpact(db, nodeOrFile, { json, depth, edgeType, includeSource, fromPackage, toPackage });
    if (result.output) console.log(result.output);
    return result.exitCode;
  } finally {
    db.close();
  }
}

/**
 * Dispatch a repo-graph command.
 *
 * @param argv Process argument vector.
 * @returns The command exit code.
 */
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
      await handleUpdate(parsed.args.dbPath, parsed.args.filePaths, parsed.args.json);
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
      return await handleAudit(parsed.args.dbPath, parsed.args.json ?? false, parsed.args.docs, parsed.args.includeInternal);
    case "explore":
      return await handleExplore(parsed.args.dbPath, parsed.args.query, parsed.args.json ?? false, parsed.args.limit, parsed.args.depth, parsed.args.includeSource);
    case "affected":
      return await handleAffected(parsed.args.dbPath, parsed.args.files, parsed.args.json ?? false, parsed.args.depth, parsed.args.testsOnly, parsed.args.filter, parsed.args.stdin);
    case "impact":
      return await handleImpact(parsed.args.dbPath, parsed.args.nodeOrFile, parsed.args.json ?? false, parsed.args.depth, parsed.args.edgeType, parsed.args.includeSource, parsed.args.fromPackage, parsed.args.toPackage);
    case "help":
      printHelp(parsed.args.subcommand);
      break;
    case "config":
      printHelp("config");
      break;
    case "install-hooks":
      await handleInstallHooks(parsed.args.path, parsed.args.force, parsed.args.json);
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
