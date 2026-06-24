import { Database } from "bun:sqlite";
import { existsSync, statSync } from "fs";

export function setMeta(db: Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

export function getMeta(db: Database, key: string): string | undefined {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  } catch (err) {
    if (err instanceof Error && err.message.includes("no such table")) {
      return undefined;
    }
    throw err;
  }
}

export function getProjectRoot(db: Database): string | undefined {
  return getMeta(db, "project_root");
}

/** Status of a file relative to its indexed record. */
export type FileFreshnessStatus = "current" | "stale" | "missing";

/**
 * Determine whether a single file is current, stale, or missing.
 *
 * A file is considered `stale` when its stored `modified_at` is newer
 * than its stored `indexed_at` (i.e. its on-disk state has changed
 * since the last scan). When no `files` row exists for the path, the
 * status is `missing`.
 */
export function isFileStale(db: Database, filePath: string): FileFreshnessStatus {
  let row: { modified_at: number; indexed_at: number } | undefined;
  try {
    row = db
      .prepare("SELECT modified_at, indexed_at FROM files WHERE path = ?")
      .get(filePath) as typeof row;
  } catch {
    return "missing";
  }
  if (!row) return "missing";
  if (row.modified_at > row.indexed_at) return "stale";
  return "current";
}

/** Stale-file entry returned by `getStaleFiles`. */
export interface StaleFileEntry {
  path: string;
  reason: "modified" | "deleted" | "unknown";
}

/**
 * Return all files whose on-disk state diverges from their indexed
 * record. A file is reported when its stored `modified_at` is newer
 * than its `indexed_at`. `reason` is `"modified"` for mtime drift
 * and `"deleted"` when the file no longer exists on disk.
 */
export function getStaleFiles(db: Database): StaleFileEntry[] {
  let rows: Array<{ path: string; modified_at: number; indexed_at: number }>;
  try {
    rows = db
      .prepare("SELECT path, modified_at, indexed_at FROM files")
      .all() as Array<{ path: string; modified_at: number; indexed_at: number }>;
  } catch {
    return [];
  }

  const stale: StaleFileEntry[] = [];
  for (const row of rows) {
    if (row.modified_at > row.indexed_at) {
      // Drift recorded in DB. The reason is "modified" unless the file
      // is also gone from disk, in which case we report "deleted".
      const onDisk = fileExists(row.path);
      stale.push({ path: row.path, reason: onDisk ? "modified" : "deleted" });
      continue;
    }
    // No recorded mtime drift. Files whose `modified_at` exactly
    // matches their `indexed_at` are treated as current regardless
    // of whether the on-disk file has been removed — the next scan
    // will reconcile.
  }
  return stale;
}

function fileExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}
