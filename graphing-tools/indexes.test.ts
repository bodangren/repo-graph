import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";

describe("createIndexes", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates all required indexes", () => {
    createIndexes(db);
    const indexes = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map((r) => r.name);

    expect(indexes).toContain("idx_nodes_type");
    expect(indexes).toContain("idx_nodes_name");
    expect(indexes).toContain("idx_nodes_file_path");
    expect(indexes).toContain("idx_nodes_layer_id");
    expect(indexes).toContain("idx_edges_source");
    expect(indexes).toContain("idx_edges_target");
    expect(indexes).toContain("idx_edges_type");
  });

  it("idx_nodes_type is on nodes(type)", () => {
    createIndexes(db);
    const info = db.query<{ name: string }, []>("PRAGMA index_info(idx_nodes_type)").all();
    expect(info.map((i) => i.name)).toContain("type");
  });

  it("idx_edges_source is on edges(source)", () => {
    createIndexes(db);
    const info = db.query<{ name: string }, []>("PRAGMA index_info(idx_edges_source)").all();
    expect(info.map((i) => i.name)).toContain("source");
  });
});
