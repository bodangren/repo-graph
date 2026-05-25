import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";

describe("createSchema", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates the nodes table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='nodes'").get();
    expect(result).toBeDefined();
  });

  it("creates the edges table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='edges'").get();
    expect(result).toBeDefined();
  });

  it("creates the layers table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='layers'").get();
    expect(result).toBeDefined();
  });

  it("creates the tour_steps table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='tour_steps'").get();
    expect(result).toBeDefined();
  });

  it("creates the meta table", () => {
    createSchema(db);
    const result = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
    expect(result).toBeDefined();
  });

  it("nodes table has correct columns", () => {
    createSchema(db);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(nodes)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("type");
    expect(names).toContain("name");
    expect(names).toContain("file_path");
    expect(names).toContain("summary");
    expect(names).toContain("tags");
    expect(names).toContain("complexity");
    expect(names).toContain("language_notes");
    expect(names).toContain("layer_id");
  });

  it("edges table has correct columns", () => {
    createSchema(db);
    const cols = db.query<{ name: string }, []>("PRAGMA table_info(edges)").all();
    const names = cols.map((c) => c.name);
    expect(names).toContain("id");
    expect(names).toContain("source");
    expect(names).toContain("target");
    expect(names).toContain("type");
    expect(names).toContain("direction");
    expect(names).toContain("weight");
    expect(names).toContain("metadata");
  });

  it("nodes.id is a primary key", () => {
    createSchema(db);
    const cols = db.query<{ name: string; pk: number }, []>("PRAGMA table_info(nodes)").all();
    const idCol = cols.find((c) => c.name === "id");
    expect(idCol?.pk).toBe(1);
  });

  it("edges.id is auto-increment primary key", () => {
    createSchema(db);
    const cols = db.query<{ name: string; pk: number }, []>("PRAGMA table_info(edges)").all();
    const idCol = cols.find((c) => c.name === "id");
    expect(idCol?.pk).toBe(1);
  });
});
