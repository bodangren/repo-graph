import { Database } from "bun:sqlite";

export interface KgNode {
  id: string;
  type: string;
  name: string;
  filePath?: string | null;
  summary?: string | null;
  tags?: string[];
  complexity?: string | null;
  languageNotes?: string | null;
}

export interface KgEdge {
  source: string;
  target: string;
  type: string;
  direction: string;
  weight?: number;
}

export function ingestNodes(db: Database, nodes: KgNode[]): void {
  const insert = db.prepare(`
    INSERT INTO nodes (id, type, name, file_path, summary, tags, complexity, language_notes, layer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((items: KgNode[]) => {
    for (const n of items) {
      insert.run(
        n.id,
        n.type,
        n.name,
        n.filePath ?? null,
        n.summary ?? null,
        JSON.stringify(n.tags ?? []),
        n.complexity ?? null,
        n.languageNotes ?? null,
        null
      );
    }
  });

  insertAll(nodes);
}

export function ingestEdges(db: Database, edges: KgEdge[]): void {
  const insert = db.prepare(`
    INSERT INTO edges (source, target, type, direction, weight)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction((items: KgEdge[]) => {
    for (const e of items) {
      insert.run(e.source, e.target, e.type, e.direction, e.weight ?? 0.5);
    }
  });

  insertAll(edges);
}
