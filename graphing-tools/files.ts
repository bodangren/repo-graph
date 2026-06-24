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
 * Compute SHA-256 content hash for a file. Returns a `sha256:<hex>`
 * prefix for parity with conventional git-style hashes. Returns
 * `null` if the file cannot be read.
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
 * Record (or refresh) a single file's metadata row in the `files`
 * table. Captures content hash, size, mtime, indexed time, and the
 * number of nodes for that file.
 */
export function recordFileMetadata(
  db: Database,
  _projectRoot: string | undefined,
  filePath: string,
  sourceFile: { getLineCount?: () => number } | null
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
 * Remove a file's `files` row, its `nodes` rows, and any edges
 * referencing those nodes. Returns counts of deleted rows.
 */
export function deleteFileData(
  db: Database,
  filePath: string
): { nodesDeleted: number; edgesDeleted: number; filesDeleted: number } {
  let nodesDeleted = 0;
  let edgesDeleted = 0;
  let filesDeleted = 0;
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
    const fileRes = fileStmt.run(filePath);
    filesDeleted = fileRes.changes;
  } catch {
    // Defensive — tables might not exist
  }
  return { nodesDeleted, edgesDeleted, filesDeleted };
}

/** Convenience: check whether a file path exists on disk. */
export function fileExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
