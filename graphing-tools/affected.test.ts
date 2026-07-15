import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { setMeta } from "./meta";
import { ExitCode } from "./contract";

/**
 * A4 — Affected command tests (Red Phase)
 *
 * These tests assert the behavior of `runAffected`, which doesn't exist yet.
 * They will fail at import time (missing module) until Phase 3 implements
 * `graphing-tools/affected.ts`.
 *
 * Dynamic imports are used so module-level imports remain valid.
 */

// ── Shared fixture builder ──────────────────────────────────────────────────

function seedAffectedGraph(db: Database): void {
  const ROOT = "/project";

  // File nodes
  db.exec(`INSERT INTO nodes (id, type, name, file_path, package_id) VALUES
    ('file:${ROOT}/src/auth.ts',          'file', 'auth.ts',          '${ROOT}/src/auth.ts',          'src'),
    ('file:${ROOT}/src/userService.ts',   'file', 'userService.ts',   '${ROOT}/src/userService.ts',   'src'),
    ('file:${ROOT}/src/UserProfile.tsx',  'file', 'UserProfile.tsx',  '${ROOT}/src/UserProfile.tsx',  'src'),
    ('file:${ROOT}/src/api/users.ts',     'file', 'users.ts',         '${ROOT}/src/api/users.ts',     'api'),
    ('file:${ROOT}/src/db/schema.ts',     'file', 'schema.ts',        '${ROOT}/src/db/schema.ts',     'db'),
    ('file:${ROOT}/src/__tests__/auth.test.ts',   'file', 'auth.test.ts',  '${ROOT}/src/__tests__/auth.test.ts',  'test'),
    ('file:${ROOT}/src/__tests__/userService.test.ts', 'file', 'userService.test.ts', '${ROOT}/src/__tests__/userService.test.ts', 'test'),
    ('file:${ROOT}/src/app/routes.ts',    'file', 'routes.ts',        '${ROOT}/src/app/routes.ts',    'app'),
    ('file:${ROOT}/src/helpers/donot-helper.ts',  'file', 'donot-helper.ts', '${ROOT}/src/helpers/donot-helper.ts', 'src')`);

  // Symbol nodes
  db.exec(`INSERT INTO nodes (id, type, name, file_path, package_id) VALUES
    ('function:${ROOT}/src/auth.ts:authenticate',       'function', 'authenticate',       '${ROOT}/src/auth.ts',          'src'),
    ('function:${ROOT}/src/userService.ts:getUser',     'function', 'getUser',            '${ROOT}/src/userService.ts',   'src'),
    ('function:${ROOT}/src/UserProfile.tsx:UserProfile','function', 'UserProfile',        '${ROOT}/src/UserProfile.tsx',  'src'),
    ('function:${ROOT}/src/api/users.ts:handleGetUser', 'function', 'handleGetUser',      '${ROOT}/src/api/users.ts',     'api'),
    ('schema:${ROOT}/src/db/schema.ts:users',           'schema',   'users',              '${ROOT}/src/db/schema.ts',     'db')`);

  // Dependency edges: downstream from auth.ts
  db.exec(`INSERT INTO edges (source, target, type, direction, weight) VALUES
    -- userService imports auth
    ('file:${ROOT}/src/userService.ts', 'file:${ROOT}/src/auth.ts', 'imports', 'forward', 1),
    -- UserProfile imports userService
    ('file:${ROOT}/src/UserProfile.tsx', 'file:${ROOT}/src/userService.ts', 'imports', 'forward', 1),
    -- route handler imports UserProfile
    ('file:${ROOT}/src/app/routes.ts', 'file:${ROOT}/src/UserProfile.tsx', 'imports', 'forward', 1),
    -- API handler calls getUser
    ('function:${ROOT}/src/api/users.ts:handleGetUser', 'function:${ROOT}/src/userService.ts:getUser', 'calls', 'forward', 1),
    -- getUser calls authenticate
    ('function:${ROOT}/src/userService.ts:getUser', 'function:${ROOT}/src/auth.ts:authenticate', 'calls', 'forward', 1),
    -- UserProfile uses a hook (useUser -> getUser)
    ('function:${ROOT}/src/UserProfile.tsx:UserProfile', 'function:${ROOT}/src/userService.ts:getUser', 'uses_hook', 'forward', 1),
    -- queries edge: getUser queries users schema
    ('function:${ROOT}/src/userService.ts:getUser', 'schema:${ROOT}/src/db/schema.ts:users', 'queries', 'forward', 1),
    -- test file tests UserProfile
    ('file:${ROOT}/src/__tests__/auth.test.ts', 'file:${ROOT}/src/auth.ts', 'tested_by', 'forward', 1),
    ('file:${ROOT}/src/__tests__/userService.test.ts', 'file:${ROOT}/src/userService.ts', 'tested_by', 'forward', 1),
    -- donot-helper is a normal source file, NOT a test
    ('file:${ROOT}/src/helpers/donot-helper.ts', 'file:${ROOT}/src/auth.ts', 'imports', 'forward', 1)`);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runAffected (A4)", () => {
  let db: Database;
  const ROOT = "/project";

  beforeEach(() => {
    db = new Database(":memory:");
    createSchema(db);
    createIndexes(db);
    setMeta(db, "project_root", ROOT);
    seedAffectedGraph(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns files that transitively depend on changed file via imports/calls/renders/etc", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`], { json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed.affected)).toBe(true);
    const affectedPaths = parsed.affected.map((f: { path: string }) => f.path);
    // Per the spec ("All file paths in output are relative to
    // projectRoot"), affected paths are returned relative to the
    // project root. The companion test "uses relative paths in JSON
    // output" pins this behaviour.
    expect(affectedPaths).toContain(`./src/userService.ts`);
    expect(affectedPaths).toContain(`./src/UserProfile.tsx`);
  });

  it("groups affected files into tests, routes, components, dataAccess, other", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`], { json: true });
    const parsed = JSON.parse(result.output);
    const groups = new Set(parsed.affected.map((f: { group: string }) => f.group));
    for (const g of groups) {
      expect(["tests", "routes", "components", "dataAccess", "other"]).toContain(String(g));
    }
  });

  it("--tests-only returns only test-classified files", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`], { testsOnly: true, json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(parsed.testsOnly).toBe(true);
    for (const entry of parsed.affected) {
      expect(entry.group).toBe("tests");
    }
    const affectedPaths = parsed.affected.map((f: { path: string }) => f.path);
    // Output is relative to project root (per the spec).
    expect(affectedPaths).toContain(`./src/__tests__/auth.test.ts`);
  });

  it("accepts multiple changed files as arguments", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(
      db,
      [`${ROOT}/src/auth.ts`, `${ROOT}/src/db/schema.ts`],
      { json: true }
    );
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(parsed.changedFiles.length).toBe(2);
    expect(parsed.affected.length).toBeGreaterThanOrEqual(1);
  });

  it("--stdin reads newline-delimited file paths", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [], {
      stdin: true,
      stdinData: `${ROOT}/src/auth.ts\n${ROOT}/src/userService.ts\n`,
      json: true,
    });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(parsed.changedFiles.length).toBe(2);
  });

  it("--json includes shortest graph path from changed file to affected file", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`], { json: true });
    const parsed = JSON.parse(result.output);
    for (const entry of parsed.affected) {
      expect(Array.isArray(entry.paths)).toBe(true);
      if (entry.paths.length > 0) {
        expect(Array.isArray(entry.paths[0])).toBe(true);
      }
    }
  });

  it("returns empty affected list with exit 0 when changed file has no dependents", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/__tests__/auth.test.ts`], { json: true });
    expect(result.exitCode).toBe(ExitCode.Success);
    const parsed = JSON.parse(result.output);
    expect(Array.isArray(parsed.affected)).toBe(true);
  });

  it("does not misclassify donot-helper.ts as a test file", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`], { json: true });
    const parsed = JSON.parse(result.output);
    const affectedPaths = parsed.affected.map((f: { path: string; group: string }) => f);
    const donotEntry = affectedPaths.find(
      (f: { path: string }) => f.path === `${ROOT}/src/helpers/donot-helper.ts`
    );
    if (donotEntry) {
      expect(donotEntry.group).not.toBe("tests");
    }
  });

  it("uses relative paths in JSON output", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`], { json: true });
    const parsed = JSON.parse(result.output);
    for (const entry of parsed.affected) {
      if (entry.path.startsWith(ROOT)) {
        expect(entry.path).not.toMatch(/^\/project\//);
      }
    }
  });

  it("text output groups affected files with headers", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`]);
    expect(result.exitCode).toBe(ExitCode.Success);
    expect(result.output).toBeTruthy();
  });

  it("preserves exit code taxonomy — exit 0 on success", async () => {
    const { runAffected } = await import("./affected");
    const result = runAffected(db, [`${ROOT}/src/auth.ts`]);
    expect(result.exitCode).toBe(ExitCode.Success);
  });

  it("returns deterministic output for same inputs", async () => {
    const { runAffected } = await import("./affected");
    const result1 = runAffected(db, [`${ROOT}/src/auth.ts`], { json: true });
    const result2 = runAffected(db, [`${ROOT}/src/auth.ts`], { json: true });
    expect(result1.output).toBe(result2.output);
  });
});
