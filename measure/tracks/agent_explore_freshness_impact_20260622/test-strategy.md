# Test Strategy: Agent Explore, Freshness, and Changed-File Impact

Baseline SHA: `ea8103a31ed00ea4b7a337b344a9172c05ddf44d`
Anti-patterns defended: A3, A4, A5, A6, A7, A9, A10 (from `measure/anti-patterns.md`).
A1, A2, A8 target supervisor regex/consent and do not apply to this product track.

---

## 1. Framework & Harness

- **Runner:** Bun's built-in `bun test` (Jest-compatible). No Vitest/Jest added.
- **Test file convention:** `graphing-tools/<feature>.test.ts` co-located with the
  module under test. New files this track introduces:
  - `graphing-tools/files.test.ts` (A2)
  - `graphing-tools/explore.test.ts` (A3)
  - `graphing-tools/affected.test.ts` (A4)
  - `graphing-tools/impact.test.ts` (A5)
  - Extensions to `graphing-tools/search.test.ts`, `schema.test.ts`,
    `update.test.ts`, `cli.test.ts`, `integration.test.ts`.
- **DB isolation (A4 guard):** Every `describe` block uses
  `beforeEach(() => { db = new Database(":memory:"); createSchema(db); })`
  and `afterEach(() => db.close())`. No shared DB state across tests.
- **Imports:** `import { describe, it, expect, beforeEach, afterEach } from "bun:test"` —
  matches existing convention in `search.test.ts`.

## 2. Red Command (Mid)

```
CI=true bun test graphing-tools/search.test.ts \
                graphing-tools/meta.test.ts \
                graphing-tools/commands.test.ts \
                graphing-tools/cli.test.ts \
                graphing-tools/integration.test.ts
```

New test files (`files.test.ts`, `explore.test.ts`, `affected.test.ts`,
`impact.test.ts`) are added in Phase 2 and become part of the Red command once
they exist. Mid extends the Red command pattern to include them after each
Phase-2 task lands.

## 3. Green Command (Jr) / Closeout

- **Green gate (per implementation task in Phase 3):** `CI=true bun test` (full
  suite) must be green after each commit. Targeted runs may precede the full
  run, but the closeout signal is the full suite.
- **Lint:** `bun run lint`.
- **Doctor:** `./measure/doctor.sh`.
- **Coverage gate (Phase 4):** `bun test --coverage` ≥ 80% lines on modified
  modules (`schema.ts`, `search.ts`, `files.ts`, `explore.ts`, `affected.ts`,
  `impact.ts`, `commands.ts`, `cli.ts`). Coverage delta is recorded in the
  closeout audit.

## 4. Per-Phase Test Set

### Phase 1 — Contract & Schema (no behavior tests; type-check only)

- `bunx tsc --noEmit` must pass with the new types in `contract.ts`
  (`ExploreArgs`, `AffectedArgs`, `ImpactArgs`, freshness/snippet payload types,
  extended `Subcommand` union).
- No `*.test.ts` files added in this phase; assertion is structural via the
  TypeScript compiler. **Defends A5** (false-claim) — Phase 1 cannot self-claim
  PASS without `tsc` exit 0.

### Phase 2 — Red Phase tests (mapped to Phase 3 tasks)

| Task    | Test file                       | Key cases                                                                                                                                                                                                                                                                                              |
| ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 FTS  | `search.test.ts`, `schema.test.ts` | `createSchema` creates `nodes_fts` virtual table when FTS5 available; insert into `nodes` triggers FTS sync (assert via `SELECT COUNT(*) FROM nodes_fts WHERE nodes_fts MATCH ?`); rank order asserts exact-name > substring; fallback path covered with a mock that throws on FTS create. |
| A2 files | `files.test.ts`, `update.test.ts` | `files` table created with all columns; full scan inserts one row per scanned file with non-null `content_hash`, `size`, `indexed_at`; incremental update refreshes `modified_at` and `content_hash`; deletion removes file + nodes + edges; freshness helper returns `{status:"stale"\|"current"\|"missing"}`. |
| A3 explore | `explore.test.ts`, `cli.test.ts` | CLI parses `explore <db> <q> --json --limit N --depth N --include-source` into `ExploreArgs`; JSON output has keys `query`, `matches`, `relationships`, `sourceSnippets`, `freshness`, `truncated`; text output uses relative paths; stale-file warning appears when fixture mtime is newer than indexed_at. |
| A4 affected | `affected.test.ts`, `cli.test.ts` | CLI parses positional file args **and** `--stdin`; reverse-edge traversal returns expected downstream files grouped `tests/routes/components/dataAccess/other`; `--tests-only` returns only test-classified files; JSON includes `paths[]` shortest-path provenance per affected file.                  |
| A5 impact | `impact.test.ts`, `cli.test.ts`  | CLI parses symbol, node ID (`function:/abs/path:name`), **and** file-path root; ambiguity returns exit code 2 with disambiguation table; not-found returns exit code 1; schema-field root surfaces `queries`/`mutates`/`param_flow` edges; affected-tests section populated.                              |

### Phase 3 — Green Phase

Each implementation commit must turn the corresponding Phase-2 red tests green
without modifying assertions. Mid runs the targeted Red command; Jr runs the
full Green command before commit.

### Phase 4 — Closeout

- `bun test --coverage` ≥ 80% on modified modules.
- `./measure/doctor.sh` green (incl. generated-facts check, **A10**).
- Smoke tests against `./bin/build-graph help {explore,affected,impact}` and a
  fixture scan that proves bounded output.

## 5. Fixture Design

Fixtures live in `graphing-tools/fixtures/`. New subdirectories:

- `fixtures/next-app/` — synthetic Next.js App Router project:
  - `app/lessons/[id]/page.tsx` (route node, renders `LessonView`)
  - `app/api/lessons/route.ts` (route handler that calls a Drizzle query)
  - `components/LessonView.tsx` (renders `useLesson` hook)
  - `hooks/useLesson.ts` (uses_hook + queries edge)
  - `db/schema.ts` (`defineTable`/Drizzle-style `scienceLessons` with `id`, `title` fields)
  - `db/queries.ts` (queries/mutates `scienceLessons`)
  - `app/lessons/__tests__/LessonView.test.tsx` (test-classifier target)
  - `tsconfig.json` minimal
- `fixtures/freshness/` — small project + a script-free helper that mutates one
  file's mtime to test stale detection deterministically.
- Existing `fixtures/sample-project/` and `fixtures/monorepo/` are reused for
  regression coverage of `search`, `deps`, `callers`, `inspect`.

Each test that touches the filesystem uses `Bun.file()`/`fs.promises` with
absolute paths derived from `import.meta.dir`. No `process.cwd()` reliance.

## 6. Coverage Targets

- ≥ 80% lines on the modules listed in §3 (workflow.md baseline).
- 100% of new exported functions have at least one test asserting non-trivial
  output shape **and** at least one negative-path test (empty graph, missing
  file, unresolved name).

## 7. Adversarial / Boundary Cases

| Case                          | Test location           | Expected behavior                                                              |
| ----------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| Empty graph (no nodes)        | `explore.test.ts`       | Returns `{matches: [], truncated: false}`, exit 0 (not 1 — "no match" is fine) |
| FTS5 unavailable              | `search.test.ts`        | Falls back to `LIKE`, marked in result metadata; test asserts both paths       |
| Deleted file on update        | `update.test.ts`        | `files`/`nodes`/`edges` rows for that path are gone (assert COUNT = 0)         |
| Ambiguous symbol on `impact`  | `impact.test.ts`        | Exit 2, disambiguation printed to stderr                                       |
| Not-found symbol on `impact`  | `impact.test.ts`        | Exit 1                                                                         |
| `--stdin` with empty input    | `affected.test.ts`      | Exit 0, `{affected: []}` (NOT a crash)                                         |
| Stale file under explore root | `explore.test.ts`       | Output includes `freshness.stale: [<relpath>]`, exit code still 0              |
| Cyclic edges in traversal     | `affected.test.ts`      | Termination guaranteed by depth limit; assert no duplicates in output          |
| Snippet line budget exceeded  | `explore.test.ts`       | `truncated: true`; snippet shorter than budget                                 |
| Long node-name FTS injection  | `search.test.ts`        | FTS query escapes/quotes special chars (`"`, `*`); no exception thrown         |

## 8. Anti-Pattern Guards (per phase)

| Anti-pattern | Phase scope                | Defense                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A3**       | All phases                 | Every count assertion uses **labeled-integer parse**, not bare digit regex. Use `expect(rows.length).toBe(7)` or `expect(result.matches.length).toBeGreaterThanOrEqual(1)`. No `toMatch(/\d+/)`. CI grep: `rg -n "toMatch\(/\\\\d\\+/\)" graphing-tools/*.test.ts` must be empty. |
| **A4**       | All phases                 | Every `it()` has at least one `expect()` against a **specific** non-empty value. No tests of the form `expect(true).toBe(true)` or `expect(result).toBeDefined()` as the only assertion. Empty-input tests assert the exact empty shape, not "no throw".                       |
| **A5**       | Phase 3 closeout, Phase 4  | Plan text only marks a task `[x]` when the full Green command exits 0. Phase 4 closeout commit must include captured `bun test` summary line; closeout audit refuses any task `[x]` without it.                                                                              |
| **A6**       | Phase 4                    | The track does not update `measure/tracks.md` claim ("FTS-backed search", "freshness warnings") until the adversarial tests for those claims (rows in §7) are green. Closeout audit cross-checks registry text against last green run.                                       |
| **A7**       | Phase 2 `affected` tests   | Test-file classifier uses **path-anchored globs** (`*.test.ts`, `__tests__/**`), not bare English-word filters. Assert with a fixture file `helpers/donot-helper.ts` that the classifier does NOT misclassify it as a test.                                                    |
| **A9**       | Phase 4 archive            | Any new tests that reference the track directory must use `measure/tracks/<id>` and be retired or rewritten at archive time. None of the new tests in §4 reference `measure/tracks/...` paths — they read code fixtures only.                                                |
| **A10**      | Phase 4 doctor             | After README + command-table updates land, run `bash measure/generate.sh` before commit. Doctor Check 5 (`git diff --exit-code measure/generated/`) is the gate.                                                                                                              |

## 9. Architecture Guardrails & Contract Risks

- **No daemon, no Node-only deps, no MCP server** (per spec NFRs). A guard test
  in `cli.test.ts` asserts that `Subcommand` does not include `serve`, `mcp`,
  `watch`.
- **Additive schema only.** A regression test opens a pre-existing `graph.db`
  built at baseline SHA (committed as `fixtures/legacy-graph.db` or rebuilt at
  test setup from `sample-project`) and confirms `createSchema` is idempotent
  and existing queries still pass. Defends spec NFR "backward-compatible".
- **Exit-code taxonomy unchanged.** `cli.test.ts` asserts the existing
  `ExitCode` mapping is preserved for `search`, `deps`, `callers`, `inspect`,
  `audit`. New commands extend, do not redefine.
- **Determinism.** JSON output for the same input DB+query must be
  byte-identical across two runs. Assert via two invocations of
  `runExplore(db, args)` and `expect(out1).toEqual(out2)`. Defends against
  random ordering in FTS rank ties.

## 10. Artifact vs Live-Behavior Tests

| Test type              | What it asserts                                          | Examples                                                                                                       |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Live behavior**      | Module API output against an in-memory SQLite + fixture | `searchNodes` FTS rank, `runExplore` JSON shape, `updateFiles` deletion, `runAffected` traversal               |
| **CLI parse**          | argv → `ParsedArgs` shape                                | `cli.test.ts` cases for each new subcommand                                                                    |
| **Artifact / docs**    | Generated facts and README                               | `doctor.sh` Check 5; integration test asserts README command-table contains `explore`, `affected`, `impact`     |
| **Smoke / e2e**        | Compiled binary against real fixture                     | Phase 4 `./bin/build-graph explore fixtures/next-app/graph.db "lesson"` exit 0 and JSON parses                  |

Artifact tests do not substitute for live-behavior tests. The Phase-2 Red set
is dominated by live-behavior tests; only Phase 4 adds artifact assertions.

## 11. Intentionally-Red Aggregate Suite

There is no intentionally-red aggregate this track. Every failing test added in
Phase 2 must turn green by the end of its corresponding Phase 3 task. If a test
cannot be made green within the track, it must be (a) deleted with rationale
recorded in `metadata.json`, or (b) demoted to a `tech-debt.md` entry with a
follow-up track. Defends **A5** (false-claim) and **A6** (registry overstatement).

## 12. Test Ordering & Isolation Summary

- Each test = fresh `new Database(":memory:")`.
- No `beforeAll` shared DB; only `beforeEach`.
- Tests do not write to repository-tracked paths. Temp paths go under
  `Bun.tempDir()` or `import.meta.dir + "/fixtures/..."` (read-only).
- File-mtime mutation for freshness tests uses `fs.utimesSync` on copies in
  `Bun.tempDir()`, never on tracked fixtures.

---

**End of strategy.** Mid-Red consumes this in Phase 2.
