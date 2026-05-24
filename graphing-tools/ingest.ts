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
