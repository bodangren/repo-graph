import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { resolve } from "path";
import { existsSync } from "fs";
import { getMetadata } from "./meta";
import { createSchema } from "./schema";
import { SCHEMA_VERSION } from "./schema";
import { persistGraph, persistSnapshotAtomically } from "./persistence";
import { scanProject } from "./scanner";
import { applyCustomEdges } from "./config";
import { syncNodeFts } from "./search";
import type { CustomEdgeDef, GraphEdge, GraphNode } from "./contract";

/** Options controlling graph update mode and persistence. */
export interface RunUpdateOptions {
  /** Treat the input list as authoritative: include a remove-only pass for files no longer present in `project`. */
  detectDeletions?: boolean;
  /** Force a full scan regardless of file list. */
  fullScan?: boolean;
  /** When true, on schema mismatch the existing DB is deleted and rebuilt from scratch. */
  resetOnConflict?: boolean;
  /** Optional commit SHA recorded in the graph metadata after success. */
  commitSha?: string | null;
  /** Schema version the caller expects. Defaults to SCHEMA_VERSION. */
  currentVersion?: string;
  /** Package ownership resolved from the project's tsconfig boundaries. */
  packageMap?: Map<string, string>;
  /** Absolute project root used for freshness and path resolution. */
  projectRoot?: string;
  /** Custom edge definitions loaded from the project configuration. */
  customEdgeDefs?: CustomEdgeDef[];
}

/** Counts and mode returned by a graph update. */
export interface RunUpdateResult {
  mode: "incremental" | "full-rescan";
  conflict: boolean;
  fallbackToFullScan: boolean;
  metadataWritten: boolean;
  filesUpdated: number;
  filesDeleted: number;
  nodesDeleted: number;
  nodesInserted: number;
  edgesDeleted: number;
  edgesInserted: number;
}

/**
 * Refresh the graph from the supplied project and report changes for requested files.
 *
 * @param db Open graph database to replace.
 * @param project Project whose source files are scanned.
 * @param filePaths Files used for change accounting and project inclusion.
 * @param options Persistence metadata and custom-edge options.
 * @returns Counts of affected files, nodes, and edges.
 */
export function updateFiles(db: Database, project: Project, filePaths: string[], options: Pick<RunUpdateOptions, "packageMap" | "projectRoot" | "commitSha" | "customEdgeDefs"> = {}): {
  filesUpdated: number;
  nodesDeleted: number;
  nodesInserted: number;
  edgesDeleted: number;
  edgesInserted: number;
  filesDeleted: number;
} {
  addRequestedSourceFiles(project, filePaths);
  const externalNodes = db
    .prepare("SELECT id, type, name, file_path, line_start, line_end, summary, documentation, tags, complexity, language_notes, layer_id, package_id FROM nodes WHERE file_path = ''")
    .all() as Array<Record<string, unknown>>;
  const requested = filePaths.map((filePath) => resolve(filePath));
  const oldNodeCount = (path: string) => (db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE file_path = ?").get(path) as { c: number } | undefined)?.c ?? 0;
  const oldEdgeCount = (path: string) => (db.prepare(`
    SELECT COUNT(*) AS c FROM edges
    WHERE source IN (SELECT id FROM nodes WHERE file_path = ?)
       OR target IN (SELECT id FROM nodes WHERE file_path = ?)
  `).get(path, path) as { c: number } | undefined)?.c ?? 0;
  const previousNodes = new Map(requested.map((path) => [path, oldNodeCount(path)]));
  const previousEdges = new Map(requested.map((path) => [path, oldEdgeCount(path)]));
  const snapshot = scanProject(project, options.packageMap);
  appendCustomEdges(snapshot, options.customEdgeDefs);
  persistGraph(db, snapshot, project, { projectRoot: options.projectRoot ?? getMetadataRoot(db), packageMap: options.packageMap, commitSha: options.commitSha });
  restoreExternalNodes(db, externalNodes, new Set(snapshot.nodes.map((node) => node.id)));

  const changedSet = new Set(requested);
  const insertedNodes = snapshot.nodes.filter((node) => changedSet.has(node.filePath)).length;
  const insertedEdges = snapshot.edges.filter((edge) => {
    const source = snapshot.nodes.find((node) => node.id === edge.source)?.filePath;
    const target = snapshot.nodes.find((node) => node.id === edge.target)?.filePath;
    return (source && changedSet.has(source)) || (target && changedSet.has(target));
  }).length;
  return {
    filesUpdated: requested.filter((path) => existsSync(path)).length,
    filesDeleted: requested.filter((path) => !existsSync(path)).length,
    nodesDeleted: Array.from(previousNodes.values()).reduce((sum, count) => sum + count, 0),
    nodesInserted: insertedNodes,
    edgesDeleted: Array.from(previousEdges.values()).reduce((sum, count) => sum + count, 0),
    edgesInserted: insertedEdges,
  };
}

function restoreExternalNodes(db: Database, rows: Array<Record<string, unknown>>, currentIds: Set<string>): void {
  if (rows.length === 0) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO nodes
      (id, type, name, file_path, line_start, line_end, summary, documentation, tags, complexity, language_notes, layer_id, package_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    const id = String(row.id);
    if (currentIds.has(id)) continue;
    insert.run(
      id,
      String(row.type),
      String(row.name),
      "",
      (row.line_start as number | null | undefined) ?? null,
      (row.line_end as number | null | undefined) ?? null,
      (row.summary as string | null | undefined) ?? null,
      (row.documentation as string | null | undefined) ?? null,
      (row.tags as string | null | undefined) ?? null,
      (row.complexity as string | null | undefined) ?? null,
      (row.language_notes as string | null | undefined) ?? null,
      (row.layer_id as string | null | undefined) ?? null,
      (row.package_id as string | null | undefined) ?? null,
    );
    const node = db.prepare("SELECT rowid, id, name, file_path, summary, documentation, tags FROM nodes WHERE id = ?").get(id) as {
      rowid: number; id: string; name: string; file_path: string; summary?: string; documentation?: string; tags?: string;
    } | undefined;
    if (node) syncNodeFts(db, { ...node, filePath: node.file_path });
  }
}

function getMetadataRoot(db: Database): string | undefined {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'project_root'").get() as { value: string } | undefined;
    return row?.value;
  } catch {
    return undefined;
  }
}

// ── runUpdate — incremental update entry point with conflict resolution ──────

/**
 * Run an incremental or full-rescan update, depending on input and
 * existing graph state. Accepts either an open `Database` handle or a
 * filesystem path. When a path is provided, this function manages the
 * DB lifecycle (open, close) and may unlink + recreate the file on
 * schema-version conflict.
 *
 * Returns a `RunUpdateResult` describing what was done.
 *
 * @param dbOrPath Open graph database or destination path.
 * @param project Project whose source files are scanned.
 * @param files Changed files used for update accounting.
 * @param options Conflict, package, metadata, and custom-edge options.
 * @returns Update mode and row-count summary.
 */
export function runUpdate(
  dbOrPath: Database | string,
  project: Project,
  files: string[],
  options: RunUpdateOptions = {}
): RunUpdateResult {
  const currentVersion = options.currentVersion ?? SCHEMA_VERSION;
  const isPath = typeof dbOrPath === "string";
  const dbPath = isPath ? String(dbOrPath) : undefined;
  let conflict = false;
  let fallbackToFullScan = files.length === 0 || options.fullScan === true;
  let existingStats: ReturnType<typeof inspectUpdateStats> = { nodes: 0, edges: 0 };

  if (isPath && dbPath && existsSync(dbPath)) {
    const existing = new Database(dbPath);
    try {
      const detection = detectMetadataState(existing);
      conflict = !!detection.metadata && detection.metadata.schemaVersion !== currentVersion;
      fallbackToFullScan ||= !detection.metaTableExists;
      existingStats = inspectUpdateStats(existing, files);
    } finally {
      existing.close();
    }
  } else if (!isPath) {
    const existing = dbOrPath as Database;
    const detection = detectMetadataState(existing);
    conflict = !detection.metaTableExists || (!!detection.metadata && detection.metadata.schemaVersion !== currentVersion);
    fallbackToFullScan ||= !detection.metaTableExists;
    existingStats = inspectUpdateStats(existing, files);
  }
  if (conflict) {
    fallbackToFullScan = true;
    console.warn("Graph state diverged — falling back to full scan");
  }

  const packageMap = options.packageMap;
  const projectRoot = options.projectRoot ?? getMetadataRootFromProject(project);
  addRequestedSourceFiles(project, files);
  if (isPath && dbPath) {
    const snapshot = scanProject(project, packageMap);
    appendCustomEdges(snapshot, options.customEdgeDefs);
    persistSnapshotAtomically(dbPath, snapshot, project, {
      projectRoot,
      packageMap,
      commitSha: options.commitSha,
      schemaVersion: currentVersion,
    });
    return makeUpdateResult(snapshot, project, files, existingStats, fallbackToFullScan, conflict);
  }

  const db = dbOrPath as Database;
  createSchema(db);
  const snapshot = scanProject(project, packageMap);
  appendCustomEdges(snapshot, options.customEdgeDefs);
  persistGraph(db, snapshot, project, { projectRoot, packageMap, commitSha: options.commitSha, schemaVersion: currentVersion });
  return makeUpdateResult(snapshot, project, files, existingStats, fallbackToFullScan, conflict);
}

function addRequestedSourceFiles(project: Project, files: string[]): void {
  for (const file of files) {
    const absolute = resolve(file);
    if (!existsSync(absolute) || !/\.(?:[cm]?[jt]sx?)$/.test(absolute)) continue;
    if (project.getSourceFile(absolute)) continue;
    try {
      project.addSourceFileAtPath(absolute);
    } catch {
      // The subsequent full scan will still publish the existing project state.
    }
  }
}

function inspectUpdateStats(db: Database, files: string[]): { nodes: number; edges: number } {
  let nodes = 0;
  let edges = 0;
  for (const file of files.map((path) => resolve(path))) {
    nodes += ((db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE file_path = ?").get(file) as { c: number } | undefined)?.c ?? 0);
    edges += ((db.prepare(`SELECT COUNT(*) AS c FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = ?) OR target IN (SELECT id FROM nodes WHERE file_path = ?)`).get(file, file) as { c: number } | undefined)?.c ?? 0);
  }
  return { nodes, edges };
}

function getMetadataRootFromProject(project: Project): string | undefined {
  const first = project.getSourceFiles()[0]?.getFilePath();
  return first ? resolve(first, "..", "..") : undefined;
}

function appendCustomEdges(snapshot: { nodes: GraphNode[]; edges: GraphEdge[] }, defs: CustomEdgeDef[] | undefined): void {
  if (!defs || defs.length === 0) return;
  snapshot.edges.push(...applyCustomEdges(snapshot.nodes, defs, snapshot.edges));
}

function makeUpdateResult(snapshot: { nodes: GraphNode[]; edges: GraphEdge[] }, project: Project, files: string[], previous: { nodes: number; edges: number }, fallbackToFullScan: boolean, conflict: boolean): RunUpdateResult {
  const requested = files.map((path) => resolve(path));
  const changed = new Set(requested);
  const nodesInserted = fallbackToFullScan ? snapshot.nodes.length : snapshot.nodes.filter((node) => changed.has(node.filePath)).length;
  const edgesInserted = fallbackToFullScan ? snapshot.edges.length : snapshot.edges.filter((edge) => {
    const source = snapshot.nodes.find((node) => node.id === edge.source)?.filePath;
    const target = snapshot.nodes.find((node) => node.id === edge.target)?.filePath;
    return (source && changed.has(source)) || (target && changed.has(target));
  }).length;
  return {
    mode: fallbackToFullScan ? "full-rescan" : "incremental",
    conflict,
    fallbackToFullScan,
    metadataWritten: true,
    filesUpdated: fallbackToFullScan ? project.getSourceFiles().length : requested.filter((path) => existsSync(path)).length,
    filesDeleted: requested.filter((path) => !existsSync(path)).length,
    nodesDeleted: previous.nodes,
    nodesInserted,
    edgesDeleted: previous.edges,
    edgesInserted,
  };
}

/** Read metadata defensively — returns undefined if the meta table is missing. */
function safeGetMetadata(db: Database): ReturnType<typeof getMetadata> {
  try {
    return getMetadata(db);
  } catch {
    return undefined;
  }
}

interface MetadataState {
  /** Whether the `meta` table itself exists. */
  metaTableExists: boolean;
  /** Decoded metadata row, or `undefined` if no row exists. */
  metadata: ReturnType<typeof getMetadata>;
}

/**
 * Inspect the DB for metadata. Distinguishes three states:
 *  - meta table does not exist (broken schema)
 *  - meta table exists but no graph metadata row (fresh DB)
 *  - graph metadata row present (with possible schema-version mismatch)
 */
function detectMetadataState(db: Database): MetadataState {
  let metaTableExists = true;
  try {
    db.prepare("SELECT 1 FROM meta LIMIT 1").get();
  } catch (err) {
    if (err instanceof Error && err.message.includes("no such table")) {
      metaTableExists = false;
    } else {
      throw err;
    }
  }
  if (!metaTableExists) {
    return { metaTableExists: false, metadata: undefined };
  }
  const metadata = safeGetMetadata(db);
  return { metaTableExists: true, metadata };
}
