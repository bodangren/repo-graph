import { Database } from "bun:sqlite";
import { statSync, readFileSync, existsSync } from "fs";
import { createHash } from "crypto";

/** Per-file metadata recorded into the `files` table during scan/update. */
export interface FileMetadataRecord {
  path: string;
  content_hash: string;
  size: number;
  modified_at: number;
  indexed_at: number;
  node_count: number;
  errors: string | null;
}

/**
 * Compute a SHA-256 content hash for a file.
 *
 * @param filePath File to read.
 * @returns A `sha256:<hex>` value, or `null` when the file cannot be read.
 */
export function hashFile(filePath: string): string | null {
  try {
    const data = readFileSync(filePath);
    return "sha256:" + createHash("sha256").update(data).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Record or refresh a single file's metadata row.
 *
 * @param db Graph database receiving the metadata.
 * @param _projectRoot Project root retained for the persistence contract.
 * @param filePath File whose metadata is recorded.
 * @param _sourceFile Parsed source file retained for the persistence contract.
 * @returns The recorded metadata, or `null` when the file cannot be read.
 */
export function recordFileMetadata(
  db: Database,
  _projectRoot: string | undefined,
  filePath: string,
  _sourceFile: unknown
): FileMetadataRecord | null {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    // File no longer on disk — nothing to record.
    return null;
  }
  const contentHash = hashFile(filePath) ?? "sha256:unreadable";
  const indexedAt = Date.now();
  const nodeCount = (() => {
    try {
      const row = db
        .prepare("SELECT COUNT(*) AS c FROM nodes WHERE file_path = ?")
        .get(filePath) as { c: number } | undefined;
      return row?.c ?? 0;
    } catch {
      return 0;
    }
  })();

  try {
    db.prepare(
      `INSERT OR REPLACE INTO files
        (path, content_hash, size, modified_at, indexed_at, node_count, errors)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`
    ).run(filePath, contentHash, stat.size, Math.floor(stat.mtimeMs), indexedAt, nodeCount);
  } catch {
    // files table not yet created — silently skip
    return null;
  }
  return {
    path: filePath,
    content_hash: contentHash,
    size: stat.size,
    modified_at: Math.floor(stat.mtimeMs),
    indexed_at: indexedAt,
    node_count: nodeCount,
    errors: null,
  };
}

/**
 * Remove a file's metadata and graph rows, including referencing edges.
 *
 * `filesDeleted` is a logical count (1 when this function is invoked
 * for a path) so that callers can count "files removed" even when no
 * `files` table row exists. `nodesDeleted` and `edgesDeleted` are
 * the actual row counts from the SQL DELETE statements.
 *
 * @param db Graph database to update.
 * @param filePath File path whose rows are removed.
 * @returns Counts of deleted files, nodes, and edges.
 */
export function deleteFileData(
  db: Database,
  filePath: string
): { nodesDeleted: number; edgesDeleted: number; filesDeleted: number } {
  let nodesDeleted = 0;
  let edgesDeleted = 0;
  try {
    // Delete edges first while the node rows still exist for the
    // subquery-based edge lookup.
    const edgeStmt = db.prepare(
      "DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = ?) OR target IN (SELECT id FROM nodes WHERE file_path = ?)"
    );
    const edgeRes = edgeStmt.run(filePath, filePath);
    edgesDeleted = edgeRes.changes;
    const nodeStmt = db.prepare("DELETE FROM nodes WHERE file_path = ?");
    const nodeRes = nodeStmt.run(filePath);
    nodesDeleted = nodeRes.changes;
    const fileStmt = db.prepare("DELETE FROM files WHERE path = ?");
    fileStmt.run(filePath);
  } catch {
    // Defensive — tables might not exist
  }
  return { nodesDeleted, edgesDeleted, filesDeleted: 1 };
}

/**
 * Check whether a file path exists on disk.
 *
 * @param p File path to check.
 * @returns Whether the path currently exists.
 */
export function fileExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
