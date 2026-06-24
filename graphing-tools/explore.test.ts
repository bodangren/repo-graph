import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { setMeta } from "./meta";
import { ExitCode } from "./contract";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * A3 — Explore command tests (Red Phase)
 *
 * These tests assert the behavior of `runExplore`, which doesn't exist yet.
 * They will fail at import time (missing module) until Phase 3 implements
 * `graphing-tools/explore.ts`.
 *
 * Dynamic imports are used for `syncNodeFts` (from search.ts — will be added in Phase 3)
 * and `runExplore` (from explore.ts — doesn't exist yet) so that the module-level
 * imports above remain valid and existing tests in other files are unaffected.
 */

// ── Shared fixture builder ──────────────────────────────────────────────────

function seedNextAppGraph(db: Database): void {
  const ROOT = "/project";

  // File nodes
  db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end, package_id) VALUES
    ('file:${ROOT}/app/lessons/[id]/page.tsx',  'file', 'page.tsx',         '${ROOT}/app/lessons/[id]/page.tsx',  1, 25,  'app'),
    ('file:${ROOT}/components/LessonView.tsx',   'file', 'LessonView.tsx',   '${ROOT}/components/LessonView.tsx',   1, 40,  'app'),
    ('file:${ROOT}/hooks/useLesson.ts',          'file', 'useLesson.ts',     '${ROOT}/hooks/useLesson.ts',          1, 30,  'app'),
    ('file:${ROOT}/db/schema.ts',                'file', 'schema.ts',        '${ROOT}/db/schema.ts',                1, 20,  'db'),
    ('file:${ROOT}/db/queries.ts',               'file', 'queries.ts',       '${ROOT}/db/queries.ts',               1, 35,  'db'),
    ('file:${ROOT}/app/lessons/__tests__/LessonView.test.tsx', 'file', 'LessonView.test.tsx', '${ROOT}/app/lessons/__tests__/LessonView.test.tsx', 1, 50, 'test')`);

  // Symbol nodes
  db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags, package_id) VALUES
    ('function:${ROOT}/app/lessons/[id]/page.tsx:LessonPage',  'function', 'LessonPage',  '${ROOT}/app/lessons/[id]/page.tsx',  5,  20, 'Renders lesson detail route',  '["exported","route"]', 'app'),
    ('function:${ROOT}/components/LessonView.tsx:LessonView',  'function', 'LessonView',  '${ROOT}/components/LessonView.tsx',  8,  35, 'Displays lesson content',       '["exported"]',         'app'),
    ('function:${ROOT}/hooks/useLesson.ts:useLesson',          'function', 'useLesson',    '${ROOT}/hooks/useLesson.ts',          3,  25, 'Fetches lesson data by ID',     '["hook","exported"]',  'app'),
    ('schema:${ROOT}/db/schema.ts:scienceLessons',             'schema',   'scienceLessons','${ROOT}/db/schema.ts',              5,  15, 'Drizzle schema for lessons',    '["drizzle"]',          'db'),
    ('field:${ROOT}/db/schema.ts:scienceLessons.id',           'field',    'id',           '${ROOT}/db/schema.ts',               6,   6, 'Primary key',                   '[]',                   'db'),
    ('field:${ROOT}/db/schema.ts:scienceLessons.title',        'field',    'title',        '${ROOT}/db/schema.ts',               7,   7, 'Lesson title column',           '[]',                   'db'),
    ('function:${ROOT}/db/queries.ts:getLessonById',           'function', 'getLessonById','${ROOT}/db/queries.ts',              3,  12, 'Queries scienceLessons by ID',  '["exported"]',         'db'),
    ('function:${ROOT}/db/queries.ts:updateLesson',            'function', 'updateLesson', '${ROOT}/db/queries.ts',             14,  25, 'Mutates scienceLessons row',    '["exported"]',         'db')`);

  // Edges
  db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
    ('file:${ROOT}/app/lessons/[id]/page.tsx', 'function:${ROOT}/app/lessons/[id]/page.tsx:LessonPage', 'contains', 'forward', 1),
    ('file:${ROOT}/components/LessonView.tsx',  'function:${ROOT}/components/LessonView.tsx:LessonView',  'contains', 'forward', 1),
    ('file:${ROOT}/hooks/useLesson.ts',         'function:${ROOT}/hooks/useLesson.ts:useLesson',          'contains', 'forward', 1),
    ('file:${ROOT}/db/schema.ts',               'schema:${ROOT}/db/schema.ts:scienceLessons',             'contains', 'forward', 1),
    ('schema:${ROOT}/db/schema.ts:scienceLessons', 'field:${ROOT}/db/schema.ts:scienceLessons.id',       'has_field','forward', 1),
    ('schema:${ROOT}/db/schema.ts:scienceLessons', 'field:${ROOT}/db/schema.ts:scienceLessons.title',    'has_field','forward', 1),
    ('file:${ROOT}/db/queries.ts',              'function:${ROOT}/db/queries.ts:getLessonById',           'contains', 'forward', 1),
    ('file:${ROOT}/db/queries.ts',              'function:${ROOT}/db/queries.ts:updateLesson',            'contains', 'forward', 1),
    ('function:${ROOT}/app/lessons/[id]/page.tsx:LessonPage', 'function:${ROOT}/components/LessonView.tsx:LessonView', 'renders', 'forward', 1),
    ('function:${ROOT}/components/LessonView.tsx:LessonView', 'function:${ROOT}/hooks/useLesson.ts:useLesson',        'uses_hook','forward', 1),
    ('function:${ROOT}/hooks/useLesson.ts:useLesson',         'function:${ROOT}/db/queries.ts:getLessonById',         'calls',   'forward', 1),
    ('function:${ROOT}/db/queries.ts:getLessonById',          'schema:${ROOT}/db/schema.ts:scienceLessons',           'queries', 'forward', 1),
    ('function:${ROOT}/db/queries.ts:updateLesson',           'schema:${ROOT}/db/schema.ts:scienceLessons',           'mutates', 'forward', 1),
    ('file:${ROOT}/app/lessons/__tests__/LessonView.test.tsx', 'function:${ROOT}/components/LessonView.tsx:LessonView', 'tested_by', 'forward', 1)`);
}

/** Insert a file metadata row with a controllable indexed_at. */
function insertFileRow(
  db: Database,
  path: string,
  opts?: { modifiedAt?: number; indexedAt?: number; nodeCount?: number }
): void {
  const now = Date.now();
  db.run(
    "INSERT INTO files (path, content_hash, size, modified_at, indexed_at, node_count) VALUES (?, ?, ?, ?, ?, ?)",
    [path, "hash_" + path, 1000, opts?.modifiedAt ?? now, opts?.indexedAt ?? now, opts?.nodeCount ?? 1]
  );
}

/** Sync all nodes into FTS using the Phase 3 helper. */
async function syncAllNodes(db: Database): Promise<void> {
  const { syncNodeFts } = await import("./search");
  const nodes = db.query("SELECT rowid, id, name, file_path, summary, tags FROM nodes").all() as Array<{
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
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runExplore (A3)", () => {
  let db: Database;
  const ROOT = "/project";

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
    setMeta(db, "project_root", ROOT);
    seedNextAppGraph(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns the best matching node with relationships and freshness", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "useLesson");
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.output).toBeTruthy();
    expect(result.output).toContain("useLesson");
    expect(result.output).toContain("LessonView");
  });

  it("--json output has all required top-level keys", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "useLesson", { json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(parsed.query).toBe("useLesson");
    expect(Array.isArray(parsed.matches)).toBe(true);
    expect(parsed.matches.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(parsed.relationships)).toBe(true);
    expect(Array.isArray(parsed.sourceSnippets)).toBe(true);
    expect(typeof parsed.freshness).toBe("object");
    expect(typeof parsed.truncated).toBe("boolean");
  });

  it("--json matches contain file path, line range, type, tags, summary", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "useLesson", { json: true });
    const parsed = JSON.parse(result.output);
    const match = parsed.matches[0];
    expect(match.id).toBe(`function:${ROOT}/hooks/useLesson.ts:useLesson`);
    expect(match.type).toBe("function");
    expect(match.name).toBe("useLesson");
    expect(match.filePath).toBeDefined();
    expect(typeof match.filePath).toBe("string");
  });

  it("--json relationships include caller and callee edges", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "useLesson", { json: true });
    const parsed = JSON.parse(result.output);
    const callRels = parsed.relationships.filter(
      (r: { edgeType: string }) => r.edgeType === "calls"
    );
    expect(callRels.length).toBeGreaterThanOrEqual(1);
  });

  it("--include-source includes bounded source snippets with stable line numbers", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "useLesson", { includeSource: true, json: true });
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed.sourceSnippets)).toBe(true);
    if (parsed.sourceSnippets.length > 0) {
      const snippet = parsed.sourceSnippets[0];
      expect(typeof snippet.filePath).toBe("string");
      expect(typeof snippet.lineStart).toBe("number");
      expect(typeof snippet.lineEnd).toBe("number");
      expect(snippet.lineStart).toBeGreaterThan(0);
      expect(snippet.lineEnd).toBeGreaterThanOrEqual(snippet.lineStart);
      expect(typeof snippet.content).toBe("string");
      expect(typeof snippet.truncated).toBe("boolean");
    }
  });

  it("text output uses relative file paths", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "useLesson");
    expect(result.output).toContain("./hooks/useLesson.ts");
    expect(result.output).not.toContain("/project/hooks/useLesson.ts");
  });

  it("text output includes line range, node type, and summary", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "useLesson");
    expect(result.output).toContain("function");
    expect(result.output).toContain("useLesson");
    expect(result.output).toContain("Fetches lesson data");
  });

  it("handles ambiguous queries deterministically by ranking", async () => {
    await syncAllNodes(db);
    const { syncNodeFts } = await import("./search");
    const { runExplore } = await import("./explore");
    // Insert two nodes with similar names
    db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags) VALUES
      ('function:${ROOT}/a.ts:getLesson', 'function', 'getLesson', '${ROOT}/a.ts', 1, 10, 'Gets a lesson', '[]'),
      ('function:${ROOT}/b.ts:getLessonData', 'function', 'getLessonData', '${ROOT}/b.ts', 1, 10, 'Gets lesson data', '[]')`);
    syncNodeFts(db, { rowid: 999, id: `function:${ROOT}/a.ts:getLesson`, name: "getLesson", filePath: `${ROOT}/a.ts`, summary: "Gets a lesson" });
    syncNodeFts(db, { rowid: 1000, id: `function:${ROOT}/b.ts:getLessonData`, name: "getLessonData", filePath: `${ROOT}/b.ts`, summary: "Gets lesson data" });

    const result1 = runExplore(db, "getLesson", { json: true });
    const result2 = runExplore(db, "getLesson", { json: true });
    expect(result1.output).toBe(result2.output);
    const parsed = JSON.parse(result1.output);
    expect(parsed.matches.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty matches with exit 0 when nothing matches", async () => {
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "zzzznonexistent", { json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(parsed.matches).toEqual([]);
    expect(parsed.truncated).toBe(false);
  });

  it("text output includes freshness warning when files are stale", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const stalePath = `${ROOT}/hooks/useLesson.ts`;
    insertFileRow(db, stalePath, {
      modifiedAt: Date.now(),
      indexedAt: Date.now() - 100_000_000,
      nodeCount: 1,
    });

    const result = runExplore(db, "useLesson", { json: true });
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed.freshness.stale)).toBe(true);
    expect(parsed.freshness.stale.length).toBeGreaterThanOrEqual(1);
  });

  it("respects --limit on matches", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result = runExplore(db, "lesson", { limit: 2, json: true });
    const parsed = JSON.parse(result.output);
    expect(parsed.matches.length).toBeLessThanOrEqual(2);
  });

  it("respects --depth for relationship fanout", async () => {
    await syncAllNodes(db);
    const { runExplore } = await import("./explore");
    const result1 = runExplore(db, "useLesson", { depth: 1, json: true });
    const result2 = runExplore(db, "useLesson", { depth: 3, json: true });
    const parsed1 = JSON.parse(result1.output);
    const parsed2 = JSON.parse(result2.output);
    expect(parsed2.relationships.length).toBeGreaterThanOrEqual(parsed1.relationships.length);
  });

  it("text output includes stale-file warning and uses relative paths", async () => {
    const { runExplore } = await import("./explore");
    const stalePath = `${ROOT}/hooks/useLesson.ts`;
    insertFileRow(db, stalePath, {
      modifiedAt: Date.now(),
      indexedAt: Date.now() - 100_000_000,
      nodeCount: 1,
    });
    const result = runExplore(db, "useLesson");
    expect(result.output).toContain("Stale files");
    expect(result.output).toContain("./hooks/useLesson.ts");
    expect(result.output).not.toContain(`${ROOT}/hooks/useLesson.ts`);
  });

  it("freshness block is deterministic for the same input", async () => {
    const { runExplore } = await import("./explore");
    const result1 = runExplore(db, "useLesson", { json: true });
    const result2 = runExplore(db, "useLesson", { json: true });
    expect(JSON.parse(result1.output).freshness).toEqual(JSON.parse(result2.output).freshness);
  });

  it("--include-source returns a source snippet for a real file", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "repo-graph-explore-"));
    try {
      const filePath = join(tempDir, "target.ts");
      writeFileSync(
        filePath,
        "export function useLesson() {\n  return 1;\n}\n",
        "utf-8"
      );
      const nodeId = `function:${filePath}:useLesson`;
      db.exec(
        `INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags) VALUES (?, 'function', 'useLesson', ?, 1, 3, 'Hook', '[]')`,
        [nodeId, filePath]
      );
      setMeta(db, "project_root", tempDir);

      const { syncNodeFts } = await import("./search");
      const row = db.prepare("SELECT rowid FROM nodes WHERE id = ?").get(nodeId) as { rowid: number };
      syncNodeFts(db, { rowid: row.rowid, id: nodeId, name: "useLesson", filePath });

      const { runExplore } = await import("./explore");
      const result = runExplore(db, "useLesson", { includeSource: true, json: true });
      const parsed = JSON.parse(result.output);
      expect(parsed.sourceSnippets.length).toBeGreaterThanOrEqual(1);
      const snippet = parsed.sourceSnippets[0];
      expect(snippet.filePath).toBe("./target.ts");
      expect(snippet.content).toContain("useLesson");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
