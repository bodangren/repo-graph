import { Database } from "bun:sqlite";
import { existsSync, statSync } from "fs";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import type { GraphMetadata } from "./contract";
import { GRAPH_META_KEY } from "./schema";

/**
 * Store a scalar metadata value.
 *
 * @param db Graph database to update.
 * @param key Metadata key.
 * @param value Metadata value.
 * @returns Nothing.
 */
export function setMeta(db: Database, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
}

/**
 * Read a scalar metadata value.
 *
 * @param db Graph database to read.
 * @param key Metadata key.
 * @returns The stored value, or `undefined` when it is absent.
 */
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

/**
 * Read structured graph metadata from the `meta` table.
 *
 * @param db Graph database to read.
 * @returns Parsed graph metadata, or `undefined` when unavailable.
 */
export function getMetadata(db: Database): GraphMetadata | undefined {
  const raw = getMeta(db, GRAPH_META_KEY);
  if (raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as GraphMetadata;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Write structured graph metadata to the `meta` table.
 *
 * @param db Graph database to update.
 * @param partial Metadata fields to merge with the existing record.
 * @returns Nothing.
 */
export function setMetadata(db: Database, partial: Partial<GraphMetadata>): void {
  const existing: Partial<GraphMetadata> = getMetadata(db) ?? {};
  const merged: GraphMetadata = {
    schemaVersion: partial.schemaVersion ?? existing.schemaVersion ?? "",
    commitSha: partial.commitSha !== undefined ? partial.commitSha : (existing.commitSha ?? null),
  };
  if (partial.lastIndexedAt !== undefined) {
    merged.lastIndexedAt = partial.lastIndexedAt;
  } else if (existing.lastIndexedAt !== undefined) {
    merged.lastIndexedAt = existing.lastIndexedAt;
  }
  setMeta(db, GRAPH_META_KEY, JSON.stringify(merged));
}

/**
 * Read the project root associated with a graph.
 *
 * @param db Graph database to read.
 * @returns Absolute project root, or `undefined` when unset.
 */
export function getProjectRoot(db: Database): string | undefined {
  return getMeta(db, "project_root");
}

/** Status of a file relative to its indexed record. */
export type FileFreshnessStatus = "current" | "stale" | "missing";

/**
 * Determine whether a single file is current, stale, or missing.
 *
 * A file is considered `stale` when its live mtime, size, or content hash
 * differs from the stored scan record. When no `files` row exists for the
 * path, or the file has been deleted, the status is `missing`.
 *
 * @param db Graph database containing the stored file record.
 * @param filePath File path to compare with the stored record.
 * @returns The current freshness status.
 */
export function isFileStale(db: Database, filePath: string): FileFreshnessStatus {
  let row: { modified_at: number; indexed_at: number; size: number; content_hash: string } | undefined;
  try {
    row = db
      .prepare("SELECT modified_at, indexed_at, size, content_hash FROM files WHERE path = ?")
      .get(filePath) as typeof row;
  } catch {
    return "missing";
  }
  if (!row || !fileExists(filePath)) return "missing";
  try {
    const stat = statSync(filePath);
    const hash = "sha256:" + createHash("sha256").update(readFileSync(filePath)).digest("hex");
    if (Math.floor(stat.mtimeMs) !== row.modified_at || stat.size !== row.size || hash !== row.content_hash) {
      return "stale";
    }
  } catch {
    return "missing";
  }
  return "current";
}

/** Stale-file entry returned by `getStaleFiles`. */
export interface StaleFileEntry {
  path: string;
  reason: "modified" | "deleted" | "unknown";
}

/**
 * Return all files whose on-disk state diverges from their indexed record.
 * `reason` is `"modified"` for mtime, size, or hash drift and `"deleted"`
 * when the file no longer exists on disk.
 *
 * @param db Graph database containing stored file records.
 * @returns Stale and missing file entries in database order.
 */
export function getStaleFiles(db: Database): StaleFileEntry[] {
  let rows: Array<{ path: string; modified_at: number; indexed_at: number; size: number; content_hash: string }>;
  try {
    rows = db
      .prepare("SELECT path, modified_at, indexed_at, size, content_hash FROM files")
      .all() as Array<{ path: string; modified_at: number; indexed_at: number; size: number; content_hash: string }>;
  } catch {
    return [];
  }

  const stale: StaleFileEntry[] = [];
  for (const row of rows) {
    if (!fileExists(row.path)) {
      stale.push({ path: row.path, reason: "deleted" });
      continue;
    }
    try {
      const stat = statSync(row.path);
      const hash = "sha256:" + createHash("sha256").update(readFileSync(row.path)).digest("hex");
      if (Math.floor(stat.mtimeMs) !== row.modified_at || stat.size !== row.size || hash !== row.content_hash) {
        stale.push({ path: row.path, reason: "modified" });
      }
    } catch {
      stale.push({ path: row.path, reason: "unknown" });
    }
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
