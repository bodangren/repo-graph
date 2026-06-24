import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { resolve } from "path";
import { existsSync, statSync, unlinkSync } from "fs";
import { scanProject } from "./scanner";
import { recordFileMetadata, deleteFileData } from "./files";
import { getMetadata, setMetadata } from "./meta";
import { createSchema } from "./schema";
import { SCHEMA_VERSION } from "./schema";

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
}

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

export function updateFiles(db: Database, project: Project, filePaths: string[]): {
  filesUpdated: number;
  nodesDeleted: number;
  nodesInserted: number;
  edgesDeleted: number;
  edgesInserted: number;
  filesDeleted: number;
} {
  const stats = {
    filesUpdated: 0,
    nodesDeleted: 0,
    nodesInserted: 0,
    edgesDeleted: 0,
    edgesInserted: 0,
    filesDeleted: 0,
  };

  const deleteNodes = db.prepare("DELETE FROM nodes WHERE file_path = ?");
  const deleteEdges = db.prepare("DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = ?) OR target IN (SELECT id FROM nodes WHERE file_path = ?)");
  const insertNode = db.prepare(`INSERT OR REPLACE INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags, complexity, layer_id, package_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEdge = db.prepare(`INSERT INTO edges (source, target, type, direction, weight, metadata)
    VALUES (?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    for (const filePath of filePaths) {
      const absPath = resolve(filePath);

      // If the file no longer exists on disk, drop its graph data
      // entirely and record a `files` removal.
      if (!existsSync(absPath)) {
        const removed = deleteFileData(db, absPath);
        stats.nodesDeleted += removed.nodesDeleted;
        stats.edgesDeleted += removed.edgesDeleted;
        stats.filesDeleted += removed.filesDeleted;
        continue;
      }

      const edgesDeleted = deleteEdges.run(absPath, absPath).changes;
      const nodesDeleted = deleteNodes.run(absPath).changes;

      stats.nodesDeleted += nodesDeleted;
      stats.edgesDeleted += edgesDeleted;

      // Re-parse only this file
      let sourceFile = project.getSourceFile(absPath);
      if (!sourceFile) {
        try {
          sourceFile = project.addSourceFileAtPath(absPath);
        } catch {
          continue;
        }
      }
      if (!sourceFile) continue;

      // Create a temporary project with just this file
      const tempProject = new Project();
      tempProject.addSourceFileAtPath(absPath);
      const { nodes, edges } = scanProject(tempProject);

      for (const node of nodes) {
        insertNode.run(
          node.id, node.type, node.name, node.filePath,
          node.lineStart ?? null, node.lineEnd ?? null,
          node.summary ?? null,
          node.tags ? JSON.stringify(node.tags) : null,
          node.complexity ?? null,
          node.layerId ?? null,
          node.packageId ?? null
        );
        stats.nodesInserted++;
      }

      for (const edge of edges) {
        insertEdge.run(edge.source, edge.target, edge.type, edge.direction, edge.weight ?? 0.5, edge.metadata ?? null);
        stats.edgesInserted++;
      }

      // Record file metadata for freshness tracking.
      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        stat = null;
      }
      const meta = recordFileMetadata(db, undefined, absPath, sourceFile);
      if (!meta && stat) {
        // Fallback: record minimal metadata if recordFileMetadata failed
        // (e.g. files table missing). No-op here; the schema.ts
        // additive migration will create it on next createSchema.
      }
      stats.filesUpdated++;
    }
  })();

  return stats;
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
 */
export function runUpdate(
  dbOrPath: Database | string,
  project: Project,
  files: string[],
  options: RunUpdateOptions = {}
): RunUpdateResult {
  const currentVersion = options.currentVersion ?? SCHEMA_VERSION;
  const isPath = typeof dbOrPath === "string";
  const dbPath = isPath ? (dbOrPath as string) : null;
  const ownedDb: Database | null = isPath ? new Database(dbOrPath as string) : null;
  const db: Database = ownedDb ?? (dbOrPath as Database);

  try {
    // 1. Inspect existing metadata for conflict.
    const detection = detectMetadataState(db);
    let conflict = false;
    let fallbackToFullScan = false;
    if (!detection.metaTableExists) {
      // meta table missing — schema is broken; full rebuild required
      conflict = true;
      fallbackToFullScan = true;
    } else if (detection.metadata === undefined) {
      // table exists, no row yet — treat as fresh; only fall back if no files provided
      if (files.length === 0) {
        conflict = false;
        fallbackToFullScan = true;
      }
    } else if (detection.metadata.schemaVersion !== currentVersion) {
      // schema-version mismatch
      conflict = true;
      fallbackToFullScan = true;
    }

    if (conflict) {
      console.warn("Graph state diverged — falling back to full scan");
    }

    // 2. On-disk reset when fallback is triggered.
    if (fallbackToFullScan && isPath && dbPath && options.resetOnConflict !== false) {
      try {
        db.close();
      } catch {
        // best-effort
      }
      try {
        unlinkSync(dbPath);
      } catch {
        // file may not exist yet — ignore
      }
      // Re-open the now-fresh DB and run the actual update on it.
      const reopened = new Database(dbPath);
      try {
        createSchema(reopened);
        return runUpdateBody(reopened, project, files, options, fallbackToFullScan, currentVersion, conflict);
      } finally {
        reopened.close();
      }
    }

    // In-memory or resetOnConflict=false path.
    if (fallbackToFullScan) {
      // Apply createSchema (idempotent) and clear data so the rebuild is clean.
      try {
        createSchema(db);
      } catch {
        // already exists
      }
      db.exec("DELETE FROM edges");
      db.exec("DELETE FROM nodes");
    }

    return runUpdateBody(db, project, files, options, fallbackToFullScan, currentVersion, conflict);
  } finally {
    if (ownedDb) {
      try {
        ownedDb.close();
      } catch {
        // ignore double-close
      }
    }
  }
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

/**
 * Internal worker: performs either a full scan or an incremental update
 * and writes metadata. Assumes the caller has already determined whether
 * fallback is required and has prepared the DB (cleared data or unlinked file).
 */
function runUpdateBody(
  db: Database,
  project: Project,
  files: string[],
  options: RunUpdateOptions,
  fallbackToFullScan: boolean,
  currentVersion: string,
  conflict: boolean
): RunUpdateResult {
  let stats: ReturnType<typeof updateFiles>;

  if (fallbackToFullScan || options.fullScan || files.length === 0) {
    // Full scan: clear all nodes/edges, then re-scan every source file in the project.
    db.exec("DELETE FROM edges");
    db.exec("DELETE FROM nodes");
    const allPaths = project.getSourceFiles().map((sf) => sf.getFilePath());
    stats = updateFiles(db, project, allPaths);
  } else {
    stats = updateFiles(db, project, files);
  }

  // Write metadata with current schema version + commit SHA.
  const metaSha = options.commitSha !== undefined ? options.commitSha : readCurrentCommitSha();
  setMetadata(db, {
    schemaVersion: currentVersion,
    commitSha: metaSha ?? null,
    lastIndexedAt: Date.now(),
  });

  return {
    mode: fallbackToFullScan ? "full-rescan" : "incremental",
    conflict,
    fallbackToFullScan,
    metadataWritten: true,
    filesUpdated: stats.filesUpdated,
    filesDeleted: stats.filesDeleted,
    nodesDeleted: stats.nodesDeleted,
    nodesInserted: stats.nodesInserted,
    edgesDeleted: stats.edgesDeleted,
    edgesInserted: stats.edgesInserted,
  };
}

/**
 * Best-effort read of the current git HEAD commit SHA. Returns `null`
 * if the command fails (e.g. not in a git repository) or times out.
 * The 5-second timeout prevents hanging on broken git installations
 * or network-mounted filesystems.
 */
function readCurrentCommitSha(): string | null {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 5_000,
    });
    if (proc.exitCode !== 0) return null;
    return proc.stdout.toString("utf8").trim() || null;
  } catch {
    return null;
  }
}
