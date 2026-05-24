import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { searchNodes } from "./search";
import { createSchema } from "./schema";

describe("searchNodes", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags) VALUES
      ('n1', 'function', 'authenticateUser', '/src/auth.ts', 'Handles user authentication', '["auth","security"]'),
      ('n2', 'function', 'validateToken', '/src/auth.ts', 'Validates JWT tokens', '["auth"]'),
      ('n3', 'class', 'UserRepository', '/src/db.ts', 'Manages user data', '[]')`);
  });

  afterEach(() => {
    db.close();
  });

  it("finds nodes by name", () => {
    const results = searchNodes(db, "auth");
    expect(results.some((r) => r.name === "authenticateUser")).toBe(true);
  });

  it("finds nodes by summary", () => {
    const results = searchNodes(db, "JWT");
    expect(results.some((r) => r.name === "validateToken")).toBe(true);
  });

  it("finds nodes by tags", () => {
    const results = searchNodes(db, "security");
    expect(results.some((r) => r.name === "authenticateUser")).toBe(true);
  });

  it("is case-insensitive", () => {
    const results = searchNodes(db, "AUTH");
    expect(results.length).toBeGreaterThan(0);
  });

  it("limits to 20 results", () => {
    // Insert 25 nodes
    for (let i = 0; i < 25; i++) {
      db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES ('x${i}', 'function', 'func${i}', '/src/a.ts')`);
    }
    const results = searchNodes(db, "func");
    expect(results.length).toBe(20);
  });

  it("returns empty array for no matches", () => {
    const results = searchNodes(db, "zzzzzz");
    expect(results.length).toBe(0);
  });
});
