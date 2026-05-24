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
  return stmt.all(like, like, like) as SearchResult[];
}
