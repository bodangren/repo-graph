import { Database } from "bun:sqlite";
import { existsSync, unlinkSync, renameSync } from "fs";
import { resolve } from "path";
import type { Project } from "ts-morph";
import type { GraphEdge, GraphNode } from "./contract";
import { createIndexes } from "./indexes";
import { createSchema } from "./schema";
import { recordFileMetadata } from "./files";
import { setMeta, setMetadata } from "./meta";
import { syncNodeFts } from "./search";
import { scanProject } from "./scanner";

/** Complete graph data ready for deterministic persistence. */
export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Options shared by full and incremental persistence. */
export interface PersistGraphOptions {
  projectRoot?: string;
  packageMap?: Map<string, string>;
  commitSha?: string | null;
  extraFiles?: string[];
  sourceFilePaths?: string[];
  schemaVersion?: string;
}

function documentationJson(node: GraphNode): string | null {
  return node.documentation ? JSON.stringify(node.documentation) : null;
}

function clearDerivedState(db: Database): void {
  try {
    db.exec("DELETE FROM nodes_fts");
  } catch {
    // FTS is optional.
  }
  db.exec("DELETE FROM edges");
  db.exec("DELETE FROM nodes");
  db.exec("DELETE FROM files");
}

/**
 * Persist a complete graph snapshot inside the supplied database transaction.
 *
 * @param db Open database receiving the snapshot.
 * @param snapshot Deterministic nodes and edges to store.
 * @param filePaths Exact source paths providing freshness metadata.
 * @param options Project, package, commit, and schema metadata.
 * @returns Nothing; the database is updated in place.
 */
export function persistGraphFromFiles(db: Database, snapshot: GraphSnapshot, filePaths: readonly string[], options: PersistGraphOptions = {}): void {
  createSchema(db);
  createIndexes(db);
  const insertNode = db.prepare(`
    INSERT INTO nodes
      (id, type, name, file_path, line_start, line_end, summary, documentation, tags, complexity, language_notes, layer_id, package_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare(`
    INSERT INTO edges (source, target, type, direction, weight, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    clearDerivedState(db);
    for (const node of snapshot.nodes) {
      insertNode.run(
        node.id,
        node.type,
        node.name,
        node.filePath,
        node.lineStart ?? null,
        node.lineEnd ?? null,
        node.summary ?? null,
        documentationJson(node),
        node.tags ? JSON.stringify(node.tags) : null,
        node.complexity ?? null,
        node.languageNotes ?? null,
        node.layerId ?? null,
        node.packageId ?? null,
      );
      const row = db.prepare("SELECT rowid FROM nodes WHERE id = ?").get(node.id) as { rowid: number } | undefined;
      if (row) {
        syncNodeFts(db, {
          rowid: row.rowid,
          id: node.id,
          name: node.name,
          filePath: node.filePath,
          summary: node.summary,
          documentation: documentationJson(node) ?? undefined,
          tags: node.tags ? JSON.stringify(node.tags) : undefined,
        });
      }
    }
    for (const edge of snapshot.edges) {
      insertEdge.run(edge.source, edge.target, edge.type, edge.direction, edge.weight ?? 0.5, edge.metadata ?? null);
    }

    for (const filePath of Array.from(new Set(filePaths)).sort()) {
      recordFileMetadata(db, options.projectRoot, filePath, null);
    }
    for (const filePath of options.extraFiles ?? []) {
      recordFileMetadata(db, options.projectRoot, filePath, null);
    }
    setMetadata(db, {
      schemaVersion: options.schemaVersion ?? "2.0.0",
      commitSha: options.commitSha ?? null,
      lastIndexedAt: Date.now(),
    });
  })();
}
/**
 * Persist a graph using source paths from an existing ts-morph Project.
 *
 * @param db Open database receiving the snapshot.
 * @param snapshot Deterministic nodes and edges to store.
 * @param project Project supplying source paths for compatibility callers.
 * @param options Project, package, commit, and schema metadata.
 * @returns Nothing; the database is updated in place.
 */
export function persistGraph(
  db: Database,
  snapshot: GraphSnapshot,
  project: Project,
  options: PersistGraphOptions = {},
): void {
  const filePaths = options.sourceFilePaths
    ?? project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath());
  persistGraphFromFiles(db, snapshot, filePaths, options);
}

/**
 * Extract a deterministic snapshot and persist it into an open database.
 *
 * @param db Open database receiving the snapshot.
 * @param project Project to scan.
 * @param options Persistence metadata and package ownership.
 * @returns The snapshot that was persisted.
 */
export function scanAndPersist(db: Database, project: Project, options: PersistGraphOptions = {}): GraphSnapshot {
  const snapshot = scanProject(project, options.packageMap);
  persistGraph(db, snapshot, project, options);
  if (options.projectRoot) setMeta(db, "project_root", resolve(options.projectRoot));
  return snapshot;
}

/**
 * Replace an on-disk graph using atomic temporary-file promotion.
 *
 * @param dbPath Destination graph database path.
 * @param project Project to scan.
 * @param options Persistence metadata and package ownership.
 * @returns The snapshot that was persisted.
 */
export function scanAndPersistAtomically(dbPath: string, project: Project, options: PersistGraphOptions = {}): GraphSnapshot {
  const absolutePath = resolve(dbPath);
  const temporaryPath = `${absolutePath}.tmp.${process.pid}.${Date.now()}`;
  let db: Database | undefined;
  try {
    db = new Database(temporaryPath);
    createSchema(db);
    createIndexes(db);
    const snapshot = scanAndPersist(db, project, options);
    db.close();
    db = undefined;
    renameSync(temporaryPath, absolutePath);
    return snapshot;
  } catch (error) {
    try { db?.close(); } catch { /* best effort */ }
    try { if (existsSync(temporaryPath)) unlinkSync(temporaryPath); } catch { /* best effort */ }
    throw error;
  }
}

/**
 * Atomically persist a caller-supplied snapshot from exact source paths.
 *
 * @param dbPath Destination graph database path.
 * @param snapshot Nodes and edges to persist.
 * @param filePaths Exact source paths providing freshness metadata.
 * @param options Persistence metadata and package ownership.
 * @returns Nothing; failed writes leave the previous destination untouched.
 */
export function persistSnapshotFromFilesAtomically(
  dbPath: string,
  snapshot: GraphSnapshot,
  filePaths: readonly string[],
  options: PersistGraphOptions = {},
): void {
  const absolutePath = resolve(dbPath);
  const temporaryPath = `${absolutePath}.tmp.${process.pid}.${Date.now()}`;
  let db: Database | undefined;
  try {
    db = new Database(temporaryPath);
    createSchema(db);
    createIndexes(db);
    persistGraphFromFiles(db, snapshot, filePaths, options);
    if (options.projectRoot) setMeta(db, "project_root", resolve(options.projectRoot));
    db.close();
    db = undefined;
    renameSync(temporaryPath, absolutePath);
  } catch (error) {
    try { db?.close(); } catch { /* best effort */ }
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    } catch {
      /* best effort */
    }
    throw error;
  }
}

/**
 * Atomically promote a caller-supplied snapshot using Project source paths.
 *
 * @param dbPath Destination graph database path.
 * @param snapshot Nodes and edges to persist.
 * @param project Project supplying file metadata for compatibility callers.
 * @param options Persistence metadata and package ownership.
 * @returns Nothing; failed writes leave the previous destination untouched.
 */
export function persistSnapshotAtomically(
  dbPath: string,
  snapshot: GraphSnapshot,
  project: Project,
  options: PersistGraphOptions = {},
): void {
  const filePaths = options.sourceFilePaths
    ?? project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath());
  persistSnapshotFromFilesAtomically(dbPath, snapshot, filePaths, options);
}

/**
 * Build the package ownership map used by full and incremental scans.
 *
 * @param project Project whose source files are mapped.
 * @param packageMap Optional existing ownership map.
 * @returns A complete map with root ownership as the fallback.
 */
export function packageMapForProject(project: Project, packageMap?: Map<string, string>): Map<string, string> {
  const result = new Map<string, string>();
  for (const sourceFile of project.getSourceFiles()) {
    result.set(sourceFile.getFilePath(), packageMap?.get(sourceFile.getFilePath()) ?? "root");
  }
  return result;
}
