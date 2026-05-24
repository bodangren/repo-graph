import { Database } from "bun:sqlite";
import type { SearchResult } from "./contract";

export function searchNodes(db: Database, keyword: string): SearchResult[] {
  const like = `%${keyword.toLowerCase()}%`;
  const stmt = db.prepare(`
    SELECT id, type, name, file_path, summary
    FROM nodes
    WHERE LOWER(name) LIKE ?
       OR LOWER(summary) LIKE ?
       OR LOWER(tags) LIKE ?
    ORDER BY type, name
    LIMIT 20
  `);
  const rows = stmt.all(like, like, like) as Array<{
    id: string;
    type: string;
    name: string;
    file_path: string;
    summary: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    type: r.type as SearchResult["type"],
    name: r.name,
    filePath: r.file_path,
    summary: r.summary ?? undefined,
  }));
}
