import { Database } from "bun:sqlite";

export function createIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_nodes_type      ON nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_name      ON nodes(name);
    CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes(file_path);
    CREATE INDEX IF NOT EXISTS idx_nodes_layer_id  ON nodes(layer_id);
    CREATE INDEX IF NOT EXISTS idx_edges_source    ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target    ON edges(target);
    CREATE INDEX IF NOT EXISTS idx_edges_type      ON edges(type);
  `);
}
