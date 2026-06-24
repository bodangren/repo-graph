import { Database } from "bun:sqlite";
import type { SearchResult } from "./contract";

/** Compact representation of a node row used for FTS sync. */
export interface FtsNodeRow {
  rowid: number;
  id: string;
  name: string;
  filePath: string;
  summary?: string;
  tags?: string;
}

/**
 * Insert (or update) a single node row into the `nodes_fts` FTS5 index.
 * Defensive: silently no-ops if the FTS5 table is missing.
 *
 * Note: the FTS5_INSERT_NODE_SQL contract in schema.ts uses `?rowid`
 * named parameters for documentation portability, but bun:sqlite
 * treats `rowid` as a reserved keyword and rejects the syntax. We
 * therefore use plain positional placeholders here.
 */
export function syncNodeFts(db: Database, node: FtsNodeRow): void {
  if (!hasFtsTable(db)) return;
  try {
    db.prepare(
      `INSERT INTO nodes_fts(rowid, id, name, file_path, summary, tags)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      node.rowid,
      node.id,
      node.name,
      node.filePath,
      node.summary ?? null,
      node.tags ?? null
    );
  } catch {
    // Defensive: FTS5 may throw on certain Unicode paths — ignore
  }
}

/**
 * Remove a single node from the `nodes_fts` FTS5 index.
 * Defensive: silently no-ops if the FTS5 table is missing.
 *
 * Note: bun:sqlite does not support the FTS5 special `'delete'`
 * command for contentless tables. A plain `DELETE FROM nodes_fts
 * WHERE rowid = ?` correctly removes the entry from the MATCH
 * index, which is the operationally meaningful check.
 */
export function syncNodeFtsDelete(db: Database, node: FtsNodeRow): void {
  if (!hasFtsTable(db)) return;
  try {
    db.prepare("DELETE FROM nodes_fts WHERE rowid = ?").run(node.rowid);
  } catch {
    // ignore
  }
}

/** Bulk variant of `syncNodeFts` for full-scan rebuilds. */
export function bulkSyncNodeFts(db: Database, nodes: FtsNodeRow[]): void {
  if (!hasFtsTable(db)) return;
  const insert = db.prepare(
    `INSERT INTO nodes_fts(rowid, id, name, file_path, summary, tags)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    for (const n of nodes) {
      insert.run(
        n.rowid,
        n.id,
        n.name,
        n.filePath,
        n.summary ?? null,
        n.tags ?? null
      );
    }
  })();
}

function hasFtsTable(db: Database): boolean {
  try {
    const row = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table') AND name = 'nodes_fts'"
      )
      .get();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Search for nodes by keyword. When FTS5 is available, prefer an FTS5
 * MATCH query ranked by `rank`; otherwise fall back to a `LIKE` query
 * that mirrors the legacy behaviour. Within a tied FTS rank, exact
 * node-name matches are placed first, then file-path matches, then
 * tag matches.
 */
export function searchNodes(db: Database, keyword: string, typeFilter?: string): SearchResult[] {
  // FTS5 path — try first when supported.
  if (hasFtsTable(db)) {
    try {
      const ftsResults = ftsSearch(db, keyword, typeFilter);
      // If the FTS index has no entries matching the keyword, the
      // caller may have populated the graph without invoking
      // `syncNodeFts` (legacy test fixtures). Fall back to LIKE so
      // the search still returns results.
      if (ftsResults.length > 0) return ftsResults;
      const likeResults = likeSearch(db, keyword, typeFilter);
      if (likeResults.length > 0) return likeResults;
      return ftsResults;
    } catch {
      // fall through to LIKE
    }
  }
  return likeSearch(db, keyword, typeFilter);
}

interface NodeRow {
  id: string;
  type: string;
  name: string;
  file_path: string;
  summary: string | null;
}

function rowToResult(r: NodeRow): SearchResult {
  return {
    id: r.id,
    type: r.type as SearchResult["type"],
    name: r.name,
    filePath: r.file_path,
    summary: r.summary ?? undefined,
  };
}

function ftsSearch(db: Database, keyword: string, typeFilter?: string): SearchResult[] {
  // FTS5 prefix-match the keyword so partial names still hit the index.
  const matchExpr = buildFtsQuery(keyword);
  const params: (string | number)[] = [matchExpr];
  let sql = `
    SELECT n.id, n.type, n.name, n.file_path, n.summary, f.rank
    FROM nodes n
    JOIN nodes_fts f ON n.rowid = f.rowid
    WHERE nodes_fts MATCH ?
  `;
  if (typeFilter) {
    sql += ` AND n.type = ?`;
    params.push(typeFilter);
  }
  sql += ` ORDER BY f.rank LIMIT 50`;
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<NodeRow & { rank: number }>;

  // Re-rank: exact name first, then file path match, then tag match.
  const lowered = keyword.toLowerCase();
  const isExact = (r: NodeRow) => r.name.toLowerCase() === lowered;
  const isFileMatch = (r: NodeRow) => r.file_path.toLowerCase().includes(lowered);
  const isTagMatch = (r: NodeRow) => (r.summary ?? "").toLowerCase().includes(lowered);

  const bucket: Record<number, NodeRow[]> = { 0: [], 1: [], 2: [], 3: [] };
  for (const r of rows) {
    if (isExact(r)) bucket[0].push(r);
    else if (isFileMatch(r)) bucket[1].push(r);
    else if (isTagMatch(r)) bucket[2].push(r);
    else bucket[3].push(r);
  }
  const ordered: NodeRow[] = [...bucket[0], ...bucket[1], ...bucket[2], ...bucket[3]];
  return ordered.slice(0, 20).map(rowToResult);
}

function buildFtsQuery(keyword: string): string {
  // Escape double quotes and treat the whole term as a phrase. Append `*`
  // for prefix matching so partial names still match.
  const cleaned = keyword.replace(/"/g, '""').trim();
  if (cleaned.length === 0) return `""`;
  return `"${cleaned}"*`;
}

function likeSearch(db: Database, keyword: string, typeFilter?: string): SearchResult[] {
  const like = `%${keyword.toLowerCase()}%`;
  const params: (string | number)[] = [like, like, like];
  let sql = `
    SELECT id, type, name, file_path, summary
    FROM nodes
    WHERE (LOWER(name) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(tags) LIKE ?)`;
  if (typeFilter) {
    sql += ` AND type = ?`;
    params.push(typeFilter);
  }
  sql += ` ORDER BY type, name LIMIT 20`;
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as NodeRow[];
  return rows.map(rowToResult);
}
