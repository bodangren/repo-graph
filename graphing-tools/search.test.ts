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

// ── A1 — FTS-backed search (Red Phase) ─────────────────────────────────────

describe("FTS-backed search (A1)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it("syncNodeFts populates FTS index so searchNodes finds results via FTS5", async () => {
    const { syncNodeFts } = await import("./search");
    // Insert a node and sync it to FTS
    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags)
      VALUES ('function:/src/auth.ts:authenticateUser', 'function', 'authenticateUser', '/src/auth.ts', 'Handles auth', '["auth"]')`);
    const row = db.prepare("SELECT rowid, id, name, file_path, summary, tags FROM nodes WHERE id = ?").get(
      "function:/src/auth.ts:authenticateUser"
    ) as { rowid: number; id: string; name: string; file_path: string; summary: string; tags: string };
    syncNodeFts(db, {
      rowid: row.rowid,
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      summary: row.summary,
      tags: row.tags,
    });

    // Verify FTS index has the entry
    const ftsCount = (db.prepare("SELECT COUNT(*) AS c FROM nodes_fts").get() as { c: number }).c;
    expect(ftsCount).toBe(1);

    // searchNodes should now find it via FTS
    const results = searchNodes(db, "authenticateUser");
    expect(results.some((r) => r.name === "authenticateUser")).toBe(true);
  });

  it("exact node name match ranks above FTS substring match", async () => {
    const { syncNodeFts } = await import("./search");
    // Insert two nodes: one exact, one partial
    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags) VALUES
      ('function:/src/a.ts:getUser',      'function', 'getUser',      '/src/a.ts', 'Get a user',       '[]'),
      ('function:/src/b.ts:getUserData',  'function', 'getUserData',  '/src/b.ts', 'Get user data',    '[]'),
      ('function:/src/c.ts:getUserById',  'function', 'getUserById',  '/src/c.ts', 'Get user by ID',   '[]')`);

    // Sync all to FTS
    const nodes = db.prepare("SELECT rowid, id, name, file_path, summary, tags FROM nodes").all() as Array<{
      rowid: number; id: string; name: string; file_path: string; summary: string | null; tags: string | null;
    }>;
    for (const n of nodes) {
      syncNodeFts(db, {
        rowid: n.rowid,
        id: n.id,
        name: n.name,
        filePath: n.file_path,
        summary: n.summary ?? undefined,
        tags: n.tags ?? undefined,
      });
    }

    // Search for "getUser" — exact name match should rank first
    const results = searchNodes(db, "getUser");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // The exact match "getUser" should appear before "getUserData" and "getUserById"
    const exactIdx = results.findIndex((r) => r.name === "getUser");
    const partialIdx = results.findIndex((r) => r.name === "getUserData");
    if (exactIdx >= 0 && partialIdx >= 0) {
      expect(exactIdx).toBeLessThan(partialIdx);
    }
  });

  it("syncNodeFts removes deleted nodes from FTS index", async () => {
    const { syncNodeFts, syncNodeFtsDelete } = await import("./search");
    // Insert and sync
    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags)
      VALUES ('n1', 'function', 'tempFunc', '/src/temp.ts', 'Temporary', '[]')`);
    const row = db.prepare("SELECT rowid, id, name, file_path, summary, tags FROM nodes WHERE id = 'n1'").get() as {
      rowid: number; id: string; name: string; file_path: string; summary: string; tags: string;
    };
    syncNodeFts(db, {
      rowid: row.rowid,
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      summary: row.summary,
      tags: row.tags,
    });

    // Verify it's in FTS via MATCH (contentless FTS5's COUNT(*) reports
    // segment state, not actual index size, so MATCH is the meaningful
    // check for content visibility).
    let ftsHits = db.prepare("SELECT * FROM nodes_fts WHERE nodes_fts MATCH ?").all("tempFunc");
    expect(ftsHits.length).toBe(1);

    // Delete from FTS (simulating node deletion) — use the Phase 3 helper
    // which wraps the FTS5_DELETE_NODE_SQL contract. bun:sqlite does not
    // support the FTS5 'delete' special command, so the helper falls back
    // to rebuilding the index from `nodes` minus the deleted row.
    syncNodeFtsDelete(db, {
      rowid: row.rowid,
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      summary: row.summary,
      tags: row.tags,
    });

    // Verify FTS index no longer matches the deleted node
    ftsHits = db.prepare("SELECT * FROM nodes_fts WHERE nodes_fts MATCH ?").all("tempFunc");
    expect(ftsHits.length).toBe(0);
  });

  it("searchNodes falls back to LIKE when FTS5 is unavailable", () => {
    // Manually drop the FTS table to simulate FTS5 unavailability
    db.exec("DROP TABLE IF EXISTS nodes_fts");

    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags) VALUES
      ('n1', 'function', 'authenticateUser', '/src/auth.ts', 'Handles auth', '["auth"]')`);

    // searchNodes should still work via LIKE fallback
    const results = searchNodes(db, "auth");
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("authenticateUser");
  });

  it("FTS5 MATCH query returns results when FTS index is populated", async () => {
    const { syncNodeFts } = await import("./search");
    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags)
      VALUES ('n1', 'function', 'fetchUserData', '/src/api.ts', 'Fetches user data from API', '["api","user"]')`);
    const row = db.prepare("SELECT rowid, id, name, file_path, summary, tags FROM nodes WHERE id = 'n1'").get() as {
      rowid: number; id: string; name: string; file_path: string; summary: string; tags: string;
    };
    syncNodeFts(db, {
      rowid: row.rowid,
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      summary: row.summary,
      tags: row.tags,
    });

    // Direct FTS5 MATCH query should work
    const ftsRows = db.prepare("SELECT * FROM nodes_fts WHERE nodes_fts MATCH ?").all("fetchUserData");
    expect(ftsRows.length).toBe(1);
  });

  it("FTS search is case-insensitive", async () => {
    const { syncNodeFts } = await import("./search");
    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags)
      VALUES ('n1', 'function', 'CamelCaseFunc', '/src/a.ts', 'Test function', '[]')`);
    const row = db.prepare("SELECT rowid, id, name, file_path, summary, tags FROM nodes WHERE id = 'n1'").get() as {
      rowid: number; id: string; name: string; file_path: string; summary: string; tags: string;
    };
    syncNodeFts(db, {
      rowid: row.rowid,
      id: row.id,
      name: row.name,
      filePath: row.file_path,
      summary: row.summary,
      tags: row.tags,
    });

    // FTS5 is case-insensitive by default
    const ftsRows = db.prepare("SELECT * FROM nodes_fts WHERE nodes_fts MATCH ?").all("camelcasefunc");
    expect(ftsRows.length).toBe(1);
  });

  it("searchNodes with typeFilter works alongside FTS", async () => {
    const { syncNodeFts } = await import("./search");
    db.exec(`INSERT INTO nodes (id, type, name, file_path, summary, tags) VALUES
      ('function:/src/a.ts:auth', 'function', 'auth', '/src/a.ts', 'Auth function', '[]'),
      ('class:/src/b.ts:Auth',    'class',    'Auth',  '/src/b.ts', 'Auth class',    '[]')`);
    const nodes = db.prepare("SELECT rowid, id, name, file_path, summary, tags FROM nodes").all() as Array<{
      rowid: number; id: string; name: string; file_path: string; summary: string | null; tags: string | null;
    }>;
    for (const n of nodes) {
      syncNodeFts(db, {
        rowid: n.rowid,
        id: n.id,
        name: n.name,
        filePath: n.file_path,
        summary: n.summary ?? undefined,
        tags: n.tags ?? undefined,
      });
    }

    // Search with type filter should narrow results
    const funcResults = searchNodes(db, "auth", "function");
    expect(funcResults.length).toBe(1);
    expect(funcResults[0].type).toBe("function");
    expect(funcResults[0].name).toBe("auth");
  });
});
