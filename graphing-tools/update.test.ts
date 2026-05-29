import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { updateFiles } from "./update";
import { createSchema } from "./schema";

describe("updateFiles", () => {
  let db: Database;
  let project: Project;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    project = new Project({
      tsConfigFilePath: "./graphing-tools/fixtures/sample-project/tsconfig.json",
    });
  });

  afterEach(() => {
    db.close();
  });

  it("deletes and re-inserts nodes for changed files", () => {
    const filePath = project.getSourceFiles()[0].getFilePath();

    // Pre-populate with old data
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES ('old', 'file', 'old.ts', '${filePath}')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES ('old', 'x', 'contains', 'forward')`);

    const stats = updateFiles(db, project, [filePath]);

    expect(stats.filesUpdated).toBe(1);
    expect(stats.nodesDeleted).toBe(1);
    expect(stats.nodesInserted).toBeGreaterThan(0);
    expect(stats.edgesDeleted).toBe(1);
    expect(stats.edgesInserted).toBeGreaterThan(0);

    // Verify old node is gone
    const oldNode = db.query("SELECT * FROM nodes WHERE id = 'old'").get();
    expect(oldNode).toBeNull();
  }, 15000);

  it("handles placeholder nodes shared across files", () => {
    const filePath = project.getSourceFiles()[0].getFilePath();

    // Pre-populate with a placeholder node (filePath="") that would be
    // recreated by scanning this file — e.g. an unresolved hook reference.
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES ('function:*:useState', 'function', 'useState', '')`);

    const stats = updateFiles(db, project, [filePath]);

    expect(stats.filesUpdated).toBe(1);
    expect(stats.nodesInserted).toBeGreaterThan(0);

    // Placeholder should still exist
    const placeholder = db.query("SELECT * FROM nodes WHERE id = 'function:*:useState'").get();
    expect(placeholder).not.toBeNull();
  }, 15000);

  it("handles relative paths when DB stores absolute paths", () => {
    const filePath = project.getSourceFiles()[0].getFilePath();
    const relativePath = filePath.replace(process.cwd() + "/", "");

    // Pre-populate with a node using the absolute path
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES ('old', 'file', 'old.ts', '${filePath}')`);
    db.exec(`INSERT INTO edges (source, target, type, direction) VALUES ('old', 'x', 'contains', 'forward')`);

    // Pass a relative path — this should resolve to the same absolute path in the DB
    const stats = updateFiles(db, project, [relativePath]);

    expect(stats.filesUpdated).toBe(1);
    expect(stats.nodesDeleted).toBe(1);
    expect(stats.nodesInserted).toBeGreaterThan(0);
    expect(stats.edgesDeleted).toBe(1);
    expect(stats.edgesInserted).toBeGreaterThan(0);

    // Verify old node is gone
    const oldNode = db.query("SELECT * FROM nodes WHERE id = 'old'").get();
    expect(oldNode).toBeNull();
  }, 15000);
});
