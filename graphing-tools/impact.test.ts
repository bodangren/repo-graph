import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { setMeta } from "./meta";
import { ExitCode } from "./contract";

/**
 * A5 — Impact command tests (Red Phase)
 *
 * These tests assert the behavior of `runImpact`, which doesn't exist yet.
 * They will fail at import time (missing module) until Phase 3 implements
 * `graphing-tools/impact.ts`.
 *
 * Dynamic imports are used so module-level imports remain valid.
 */

// ── Shared fixture builder ──────────────────────────────────────────────────

function seedImpactGraph(db: Database): void {
  const ROOT = "/project";

  // File nodes
  db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end, package_id) VALUES
    ('file:${ROOT}/src/db/schema.ts',              'file', 'schema.ts',        '${ROOT}/src/db/schema.ts',              1, 20,  'db'),
    ('file:${ROOT}/src/db/queries.ts',             'file', 'queries.ts',       '${ROOT}/src/db/queries.ts',             1, 40,  'db'),
    ('file:${ROOT}/src/api/lessons.ts',            'file', 'lessons.ts',       '${ROOT}/src/api/lessons.ts',            1, 30,  'api'),
    ('file:${ROOT}/components/LessonView.tsx',     'file', 'LessonView.tsx',   '${ROOT}/components/LessonView.tsx',     1, 45,  'app'),
    ('file:${ROOT}/src/hooks/useLesson.ts',        'file', 'useLesson.ts',     '${ROOT}/src/hooks/useLesson.ts',        1, 25,  'app'),
    ('file:${ROOT}/app/lessons/[id]/page.tsx',     'file', 'page.tsx',         '${ROOT}/app/lessons/[id]/page.tsx',     1, 20,  'app'),
    ('file:${ROOT}/app/lessons/__tests__/LessonView.test.tsx', 'file', 'LessonView.test.tsx', '${ROOT}/app/lessons/__tests__/LessonView.test.tsx', 1, 50, 'test'),
    ('file:${ROOT}/src/db/migrations/001.sql',     'file', '001.sql',          '${ROOT}/src/db/migrations/001.sql',     1, 10,  'db')`);

  // Symbol nodes
  db.exec(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags, package_id) VALUES
    ('schema:${ROOT}/src/db/schema.ts:scienceLessons',         'schema',   'scienceLessons',  '${ROOT}/src/db/schema.ts',          5, 15, 'Drizzle schema for lessons', '["drizzle"]',         'db'),
    ('field:${ROOT}/src/db/schema.ts:scienceLessons.id',       'field',    'id',              '${ROOT}/src/db/schema.ts',          6,  6, 'Primary key',                '[]',                  'db'),
    ('field:${ROOT}/src/db/schema.ts:scienceLessons.title',    'field',    'title',           '${ROOT}/src/db/schema.ts',          7,  7, 'Lesson title',               '[]',                  'db'),
    ('field:${ROOT}/src/db/schema.ts:scienceLessons.content',  'field',    'content',         '${ROOT}/src/db/schema.ts',          8,  8, 'Lesson body',                '[]',                  'db'),
    ('function:${ROOT}/src/db/queries.ts:getLessonById',       'function', 'getLessonById',   '${ROOT}/src/db/queries.ts',         3, 12, 'Query lesson by ID',         '["exported"]',        'db'),
    ('function:${ROOT}/src/db/queries.ts:updateLesson',        'function', 'updateLesson',    '${ROOT}/src/db/queries.ts',        14, 25, 'Update lesson row',          '["exported"]',        'db'),
    ('function:${ROOT}/src/api/lessons.ts:handleGetLesson',    'function', 'handleGetLesson', '${ROOT}/src/api/lessons.ts',        3, 15, 'Route handler for GET',      '["route","exported"]','api'),
    ('function:${ROOT}/components/LessonView.tsx:LessonView',  'function', 'LessonView',      '${ROOT}/components/LessonView.tsx', 8, 35, 'Renders lesson UI',          '["exported"]',        'app'),
    ('function:${ROOT}/src/hooks/useLesson.ts:useLesson',      'function', 'useLesson',       '${ROOT}/src/hooks/useLesson.ts',    3, 20, 'Hook for lesson data',       '["hook","exported"]', 'app'),
    ('function:${ROOT}/app/lessons/[id]/page.tsx:LessonPage',  'function', 'LessonPage',      '${ROOT}/app/lessons/[id]/page.tsx',  5, 18, 'Route page component',       '["route"]',           'app')`);

  // Edges
  db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
    -- schema has fields
    ('schema:${ROOT}/src/db/schema.ts:scienceLessons', 'field:${ROOT}/src/db/schema.ts:scienceLessons.id',      'has_field', 'forward', 1),
    ('schema:${ROOT}/src/db/schema.ts:scienceLessons', 'field:${ROOT}/src/db/schema.ts:scienceLessons.title',   'has_field', 'forward', 1),
    ('schema:${ROOT}/src/db/schema.ts:scienceLessons', 'field:${ROOT}/src/db/schema.ts:scienceLessons.content', 'has_field', 'forward', 1),
    -- queries reference schema
    ('function:${ROOT}/src/db/queries.ts:getLessonById', 'schema:${ROOT}/src/db/schema.ts:scienceLessons', 'queries', 'forward', 1),
    ('function:${ROOT}/src/db/queries.ts:updateLesson',  'schema:${ROOT}/src/db/schema.ts:scienceLessons', 'mutates', 'forward', 1),
    -- API handler calls query
    ('function:${ROOT}/src/api/lessons.ts:handleGetLesson', 'function:${ROOT}/src/db/queries.ts:getLessonById', 'calls', 'forward', 1),
    -- param_flow from route to handler
    ('function:${ROOT}/app/lessons/[id]/page.tsx:LessonPage', 'function:${ROOT}/src/api/lessons.ts:handleGetLesson', 'param_flow', 'forward', 1),
    -- page renders LessonView
    ('function:${ROOT}/app/lessons/[id]/page.tsx:LessonPage', 'function:${ROOT}/components/LessonView.tsx:LessonView', 'renders', 'forward', 1),
    -- LessonView uses hook
    ('function:${ROOT}/components/LessonView.tsx:LessonView', 'function:${ROOT}/src/hooks/useLesson.ts:useLesson', 'uses_hook', 'forward', 1),
    -- hook calls query
    ('function:${ROOT}/src/hooks/useLesson.ts:useLesson', 'function:${ROOT}/src/db/queries.ts:getLessonById', 'calls', 'forward', 1),
    -- test tests LessonView
    ('file:${ROOT}/app/lessons/__tests__/LessonView.test.tsx', 'function:${ROOT}/components/LessonView.tsx:LessonView', 'tested_by', 'forward', 1),
    -- another node that references the schema (e.g. a migration reference)
    ('file:${ROOT}/src/db/migrations/001.sql', 'schema:${ROOT}/src/db/schema.ts:scienceLessons', 'references', 'forward', 1)`);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runImpact (A5)", () => {
  let db: Database;
  const ROOT = "/project";

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
    setMeta(db, "project_root", ROOT);
    seedImpactGraph(db);
  });

  afterEach(() => {
    db.close();
  });

  it("walks both incoming and outgoing relationships from a symbol", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed.relationships)).toBe(true);
    const outgoing = parsed.relationships.filter(
      (r: { direction: string }) => r.direction === "forward"
    );
    expect(outgoing.length).toBeGreaterThanOrEqual(1);
    const incoming = parsed.relationships.filter(
      (r: { direction: string }) => r.direction === "backward"
    );
    expect(incoming.length).toBeGreaterThanOrEqual(1);
  });

  it("accepts a fully-qualified node ID as root", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, `schema:${ROOT}/src/db/schema.ts:scienceLessons`, { json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(parsed.root).toContain("scienceLessons");
  });

  it("accepts exact file paths as roots", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, `${ROOT}/src/db/schema.ts`, { json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(parsed.relationships.length).toBeGreaterThanOrEqual(1);
  });

  it("--depth N limits traversal depth", async () => {
    const { runImpact } = await import("./impact");
    const shallow = runImpact(db, "schema:scienceLessons", { depth: 1, json: true });
    const deep = runImpact(db, "schema:scienceLessons", { depth: 3, json: true });
    const parsedShallow = JSON.parse(shallow.output);
    const parsedDeep = JSON.parse(deep.output);
    expect(parsedDeep.relationships.length).toBeGreaterThanOrEqual(parsedShallow.relationships.length);
  });

  it("surfaces route handlers prominently", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { json: true });
    const parsed = JSON.parse(result.output);
    const relNames = parsed.relationships.map(
      (r: { targetName: string; sourceName: string }) => r.targetName ?? r.sourceName
    );
    const hasRouteHandler = relNames.some((n: string) => n.includes("handleGetLesson") || n.includes("LessonPage"));
    expect(hasRouteHandler).toBe(true);
  });

  it("surfaces rendered components prominently", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { depth: 3, json: true });
    const parsed = JSON.parse(result.output);
    const relNames = parsed.relationships.map(
      (r: { targetName: string; sourceName: string }) => r.targetName ?? r.sourceName
    );
    const hasComponent = relNames.some((n: string) => n.includes("LessonView"));
    expect(hasComponent).toBe(true);
  });

  it("surfaces hooks prominently", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { depth: 3, json: true });
    const parsed = JSON.parse(result.output);
    const relNames = parsed.relationships.map(
      (r: { targetName: string; sourceName: string }) => r.targetName ?? r.sourceName
    );
    const hasHook = relNames.some((n: string) => n.includes("useLesson"));
    expect(hasHook).toBe(true);
  });

  it("surfaces param_flow edges", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, `function:${ROOT}/app/lessons/[id]/page.tsx:LessonPage`, { json: true });
    const parsed = JSON.parse(result.output);
    const paramFlowRels = parsed.relationships.filter(
      (r: { edgeType: string }) => r.edgeType === "param_flow"
    );
    expect(paramFlowRels.length).toBeGreaterThanOrEqual(1);
  });

  it("includes affected tests using the same classifier as affected", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { depth: 3, json: true });
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed.affectedTests)).toBe(true);
    expect(parsed.affectedTests).toContain(
      `${ROOT}/app/lessons/__tests__/LessonView.test.tsx`
    );
  });

  it("reports ambiguous symbols with exit code 2", async () => {
    const { runImpact } = await import("./impact");
    db.exec(`INSERT INTO nodes (id, type, name, file_path) VALUES
      ('function:${ROOT}/src/other/queries.ts:getLessonById', 'function', 'getLessonById', '${ROOT}/src/other/queries.ts')`);
    const result = runImpact(db, "getLessonById", { json: true });
    expect(result.exitCode).toBe(ExitCode.Ambiguous);
  });

  it("exits 1 on missing symbol", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "zzzznonexistent", { json: true });
    expect(result.exitCode).toBe(ExitCode.NotFound);
  });

  it("returns freshness block with stale and missing arrays", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { json: true });
    const parsed = JSON.parse(result.output);
    expect(typeof parsed.freshness).toBe("object");
    expect(Array.isArray(parsed.freshness.stale)).toBe(true);
    expect(Array.isArray(parsed.freshness.missing)).toBe(true);
    expect(typeof parsed.freshness.checkedAt).toBe("number");
  });

  it("text output uses relative paths", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons");
    expect(result.exitCode).toBe(ExitCode.Success);
    if (result.output.includes(ROOT)) {
      expect(result.output).not.toMatch(/\/project\/src/);
    }
  });

  it("--json output has all required keys", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { json: true });
    const parsed = JSON.parse(result.output);
    expect(typeof parsed.root).toBe("string");
    expect(Array.isArray(parsed.relationships)).toBe(true);
    expect(Array.isArray(parsed.affectedTests)).toBe(true);
    expect(typeof parsed.freshness).toBe("object");
    expect(typeof parsed.truncated).toBe("boolean");
  });

  it("returns deterministic output for same inputs", async () => {
    const { runImpact } = await import("./impact");
    const result1 = runImpact(db, "schema:scienceLessons", { json: true });
    const result2 = runImpact(db, "schema:scienceLessons", { json: true });
    expect(result1.output).toBe(result2.output);
  });

  it("respects --edge-type filter for traversal", async () => {
    const { runImpact } = await import("./impact");
    const result = runImpact(db, "schema:scienceLessons", { edgeType: "has_field", json: true });
    const parsed = JSON.parse(result.output);
    for (const rel of parsed.relationships) {
      expect(rel.edgeType).toBe("has_field");
    }
  });
});
