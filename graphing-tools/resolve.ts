import { Database } from "bun:sqlite";
import type { SearchResult } from "./contract";

export interface ResolvedNode {
  id: string;
  type: string;
  name: string;
  filePath: string;
}

export type ResolveResult =
  | { kind: "single"; node: ResolvedNode }
  | { kind: "ambiguous"; matches: SearchResult[] }
  | { kind: "none" };

export function resolveNode(db: Database, name: string): ResolveResult {
  // Try exact ID match first
  const byId = db.prepare("SELECT id, type, name, file_path FROM nodes WHERE id = ?").get(name) as
    | { id: string; type: string; name: string; file_path: string }
    | undefined;
  if (byId) {
    return { kind: "single", node: { id: byId.id, type: byId.type, name: byId.name, filePath: byId.file_path } };
  }

  // Try exact name match
  const byName = db.prepare("SELECT id, type, name, file_path FROM nodes WHERE name = ? COLLATE NOCASE").all(name) as
    Array<{ id: string; type: string; name: string; file_path: string }>;

  if (byName.length === 1) {
    const n = byName[0];
    return { kind: "single", node: { id: n.id, type: n.type, name: n.name, filePath: n.file_path } };
  }

  if (byName.length > 1) {
    return {
      kind: "ambiguous",
      matches: byName.map((n) => ({
        id: n.id,
        type: n.type as SearchResult["type"],
        name: n.name,
        filePath: n.file_path,
      })),
    };
  }

  // Try partial name match
  const like = `%${name.toLowerCase()}%`;
  const partial = db.prepare("SELECT id, type, name, file_path FROM nodes WHERE LOWER(name) LIKE ?").all(like) as
    Array<{ id: string; type: string; name: string; file_path: string }>;

  if (partial.length === 1) {
    const n = partial[0];
    return { kind: "single", node: { id: n.id, type: n.type, name: n.name, filePath: n.file_path } };
  }

  if (partial.length > 1) {
    return {
      kind: "ambiguous",
      matches: partial.map((n) => ({
        id: n.id,
        type: n.type as SearchResult["type"],
        name: n.name,
        filePath: n.file_path,
      })),
    };
  }

  return { kind: "none" };
}
