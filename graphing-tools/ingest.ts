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

export interface KgLayer {
  id: string;
  name: string;
  description?: string | null;
  nodeIds?: string[];
}

export interface KgTourStep {
  orderIndex: number;
  title: string;
  description?: string | null;
  nodeIds?: string[];
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

export function ingestLayers(db: Database, layers: KgLayer[]): void {
  const insert = db.prepare(`
    INSERT INTO layers (id, name, description, node_ids)
    VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction((items: KgLayer[]) => {
    for (const l of items) {
      insert.run(l.id, l.name, l.description ?? null, JSON.stringify(l.nodeIds ?? []));
    }
  });

  insertAll(layers);
}

export function ingestTourSteps(db: Database, steps: KgTourStep[]): void {
  const insert = db.prepare(`
    INSERT INTO tour_steps (order_index, title, description, node_ids)
    VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction((items: KgTourStep[]) => {
    for (const s of items) {
      insert.run(s.orderIndex, s.title, s.description ?? null, JSON.stringify(s.nodeIds ?? []));
    }
  });

  insertAll(steps);
}

export function resolveLayerIds(db: Database): void {
  db.exec(`
    UPDATE nodes SET layer_id = (
      SELECT l.id
      FROM layers l, json_each(l.node_ids) AS je
      WHERE je.value = nodes.id
      LIMIT 1
    )
  `);
}
