# Test Strategy — `git_hook_incremental_updates_20260528`

**Baseline SHA:** `5821f7d` (HEAD after Track `agent_explore_freshness_impact_20260622` closeout)
**Track phase entry:** track setup → Mid-Red for Phase 1 next.
**Scope:** Wire `repo-graph update` into git lifecycle hooks (pre-commit, post-checkout), add metadata schema versioning, and conflict-resolution fallback.

---

## 0. Pre-flight: existing baseline behavior

Before Phase 3 starts implementing anything, the strategy fixes the *invariant baseline* — what already works in the repo and **must continue to work** after the track lands. This is the contract Phase 3 implementation may NOT regress.

`graphing-tools/update.ts` already exports `updateFiles(db, project, filePaths)` (see file at baseline SHA). Verified behavior at `5821f7d`:

| Existing capability | File | Status |
|---|---|---|
| Remove old nodes by `file_path` | `update.ts` L25, L47 | ✅ implemented |
| Remove dangling edges (source OR target in deleted nodes) | `update.ts` L26, L46 | ✅ implemented |
| Per-file re-parse + reinsert (nodes + edges) | `update.ts` L52–L84 | ✅ implemented |
| Deleted-file handling via `deleteFileData` | `update.ts` L38–L44 | ✅ implemented |
| Relative-path resolution | `update.ts` L34 (`resolve(filePath)`) | ✅ implemented + tested (`update.test.ts` L60–L80) |
| Placeholder node preservation | `update.test.ts` L43–L58 | ✅ tested |
| `meta` table for `project_root` | `schema.ts` L116–L119, `meta.ts` `getMeta/setMeta` | ✅ implemented |
| File-freshness `files` table | `schema.ts` L50–L60, `files.ts` | ✅ implemented |

**This track ADDS (not yet implemented at baseline):**

1. `schema_version` and `commit_sha` columns/keys on the `meta` table.
2. `GraphMetadata` interface in `contract.ts` + `getMetadata()`/`setMetadata()` operations.
3. Full-scan fallback when `updateFiles` is invoked with an empty file list.
4. Renamed-file handling (currently treated as delete-then-add only if both old + new are passed; no explicit rename detection — strategy will treat renames as caller-supplied "remove old + add new", which matches spec G3).
5. `commit_sha` written to `meta` on every successful update.
6. New `installHooks.ts` module + `repo-graph install-hooks` CLI subcommand.
7. Conflict detection: `schema_version` mismatch or missing `meta` table ⇒ warn + delete DB + full rescan.
8. `Subcommand` union must add `"install-hooks"` to `contract.ts` L10.
9. POSIX-compliant generated `pre-commit` and `post-checkout` hook scripts.

> **Plan ↔ baseline reconciliation:** Plan Phase 2 "G1 — `update` removes old nodes for a changed file and inserts new ones" and "G1 — `update` removes dangling edges" and "G1 — `update` handles deleted files by removing all nodes for that path" describe **already-implemented** behavior. Phase 2 Red MUST add these as **regression tests** (not new functionality). They must be written so they would catch a regression of `updateFiles` — i.e., they must fail if L25–L47 are deleted. They are NOT vacuous: they exercise the existing code path with adversarial setup (pre-populated old node + dangling edge + re-scan target).

---

## 1. Test framework & harness

- **Runner:** Bun's built-in `bun test` (already in use across `graphing-tools/*.test.ts`).
- **DB harness:** `new Database(":memory:")` + `createSchema(db)` in `beforeEach`. `db.close()` in `afterEach`. Pattern established in `update.test.ts` L11–L21 — extend, don't replace.
- **ts-morph fixture:** Reuse `graphing-tools/fixtures/sample-project/tsconfig.json` for `update.test.ts` additions. No new TS source fixtures needed.
- **Git fixture:** For `hooks.test.ts`, build a fresh disposable git repo per test:
  - `os.tmpdir() + '/' + crypto.randomUUID() + '/'` directory.
  - `fs.mkdirSync(tmp, { recursive: true })`; `fs.mkdirSync(tmp + '/.git/hooks', { recursive: true })`.
  - `afterEach` does `fs.rmSync(tmp, { recursive: true, force: true })`. No real `git init` is needed; the spec only requires the `.git/hooks/` directory exist — `installHooks` writes scripts there.
- **No global state:** Each test file owns its DBs/dirs. Never share between tests.

---

## 2. Per-phase test set

### Phase 1 — Contract & Schema (tsc gate only)

**Red command:** `bunx tsc --noEmit` (project-wide TS gate; no `*.test.ts` change yet).

**Red signal:** `contract.test.ts` and `update.test.ts` must *reference* `GraphMetadata`, `getMetadata`, `setMetadata`, and the new `meta` keys (`schema_version`, `commit_sha`). At the start of Phase 1, those references do not yet resolve — `bunx tsc --noEmit` exits non-zero with:

- `Cannot find name 'GraphMetadata'` in `contract.test.ts`
- `Module '"./meta"' has no exported member 'getMetadata'` in `update.test.ts`

**Green gate:** `bunx tsc --noEmit` exits 0 AND `CI=true bun test graphing-tools/contract.test.ts` passes (the contract test asserts `GraphMetadata` has `schemaVersion: string` and `commitSha: string` fields via a TS-only structural test — a fixture object that fails to typecheck if the interface drifts).

**Closeout gate:**
1. `bun run lint` clean.
2. `bunx tsc --noEmit` clean.
3. `CI=true bun test graphing-tools/contract.test.ts graphing-tools/schema.test.ts` passes.
4. `schema.ts` writes `schema_version` to the `meta` table on `createSchema` (verifiable: `SELECT value FROM meta WHERE key = 'schema_version'` returns the current version constant).
5. No product source outside `contract.ts`, `schema.ts`, `meta.ts` is touched.

### Phase 2 — Tests Red Phase

**Red command (precise):**

```bash
CI=true bun test graphing-tools/update.test.ts graphing-tools/hooks.test.ts graphing-tools/contract.test.ts
```

**Expected Red signal:** at least 1 failing test per new requirement (counted as labeled integers, A3 guard):

```
Phase2:NewTestsRed:[N]   # where N = explicit failing-test count, parsed from bun's "X fail" line
```

The Red phase introduces ≥ 13 new failing tests:

#### `update.test.ts` additions (Red — 7 tests)

| ID | Description | Falsifiable assertion |
|---|---|---|
| U1 | Dangling edge cleanup after node removal (regression guard) | After `updateFiles(db, project, [file])`, `SELECT COUNT(*) FROM edges WHERE source NOT IN (SELECT id FROM nodes) OR target NOT IN (SELECT id FROM nodes WHERE file_path != '')` returns labeled `0`. |
| U2 | Full-scan fallback when no files provided | `updateFiles(db, project, [])` returns `stats.filesUpdated >= 1` AND inserts ≥ 1 node from each fixture file. Adversarial: empty array, not undefined. |
| U3 | Deleted file (regression guard) | Pre-insert node for `/missing/foo.ts`; pass `['/missing/foo.ts']`; assert `stats.filesDeleted == 1` AND node row gone. |
| U4 | Renamed file (remove old + add new) | Pre-insert node for `old.ts`; pass `['old.ts', 'new.ts']` where `old.ts` is missing on disk and `new.ts` is the fixture; assert `stats.filesDeleted == 1` AND `stats.filesUpdated == 1` AND new-path nodes inserted. |
| U5 | `commit_sha` written to metadata | After update, `getMetadata(db).commitSha` equals the value passed in (caller supplies it; pure unit, no shell-out). Assert: `typeof commitSha === 'string'` AND `commitSha.length > 0`. |
| U6 | Schema version mismatch ⇒ full-scan fallback | Pre-write `meta.schema_version = 'v0-bogus'`; call `runUpdate(db, project, [file], { currentVersion: 'v1' })`; assert returned `mode === 'full-rescan'` AND a warning was captured on stderr matching exact substring `Graph state diverged`. |
| U7 | Missing `meta` table ⇒ full-scan fallback | `db.exec('DROP TABLE meta')`; call `runUpdate(...)`; assert returned `mode === 'full-rescan'` AND warning emitted. |

#### `hooks.test.ts` (new file, Red — 4 tests)

| ID | Description | Falsifiable assertion |
|---|---|---|
| H1 | `installHooks` creates `pre-commit` | After call, `fs.existsSync(tmp + '/.git/hooks/pre-commit')` is `true` AND contents include exact substring `git diff --cached --name-only --diff-filter=ACM` AND start with `#!/bin/sh`. |
| H2 | `installHooks` creates `post-checkout` | Same, content includes `git diff --name-only "$1" "$2"`. |
| H3 | Idempotency on second run | Run `installHooks` twice; second run returns `{ overwritten: ['pre-commit', 'post-checkout'] }`; file contents byte-identical to first run. |
| H4 | Warns on non-repo-graph existing content | Pre-write `pre-commit` containing `echo "hand-rolled"`; call `installHooks`; capture stderr; assert it contains exact substring `Overwriting existing hook` AND the original content is preserved as `pre-commit.bak`. |

#### `contract.test.ts` additions (Red — 2 tests)

| ID | Description | Falsifiable assertion |
|---|---|---|
| C1 | `GraphMetadata` has required fields | Compile-time structural test: a typed literal `const m: GraphMetadata = { schemaVersion: 'v1', commitSha: 'abc' }` is part of the test file. If the interface drops a field, `tsc` fails. Plus runtime `expect(Object.keys(m).sort()).toEqual(['commitSha', 'schemaVersion'])`. |
| C2 | `Subcommand` union includes `'install-hooks'` | Compile-time: `const s: Subcommand = 'install-hooks'`. Plus runtime: the help registry exports an entry keyed by `'install-hooks'`. |

**Closeout gate for Phase 2:** Red command exits non-zero, parsed `Phase2:NewTestsRed:[N]` ≥ 13. Pre-existing 172-test suite must still pass apart from new failures (verified by `CI=true bun test --bail=false` and diffing the failure set).

### Phase 3 — Implementation (Green Phase)

**Green command (full project):** `CI=true bun test`

**Green gates (per task):**

1. **G1 — Incremental update:** `CI=true bun test graphing-tools/update.test.ts` ⇒ all U1–U5 green. U6/U7 still red until G4.
2. **G2 — Hook installation:** `CI=true bun test graphing-tools/hooks.test.ts` ⇒ H1–H4 green.
3. **G4 — Conflict resolution:** `CI=true bun test graphing-tools/update.test.ts` ⇒ U6, U7 green.

**Closeout gate for Phase 3:**
- `CI=true bun test` exits 0 with `0 fail` across the full suite.
- `bun run lint` exits 0.
- `bunx tsc --noEmit` exits 0.
- No `update.test.ts` test of the **baseline** behavior (the three tests already in the file at SHA `5821f7d`) was modified. They are regression-locked.
- The `Subcommand` switch in `cli.ts` has a case for `"install-hooks"` and a case for `"update"` that calls into `runUpdate`.

### Phase 4 — Coverage, Generated Docs, Doctor & Install

**Red command:** `bun test --coverage` + `./measure/doctor.sh` + `bun run build`.

**Green gate:**
- Coverage report shows `update.ts`, `installHooks.ts`, `meta.ts` at ≥ 80% line coverage (extract with `Coverage:[[:space:]]*([0-9]+\.[0-9]+)%` labeled-integer pattern from the JSON coverage output, not bare digits).
- `./measure/generate.sh` runs; `git diff --exit-code measure/generated/` clean.
- `./measure/doctor.sh` exits 0.
- `bun run build` produces `./bin/repo-graph`.
- Manual smoke test in a real repo: `install-hooks` is executed against a throwaway repo; pre-commit fires `repo-graph update` and updates `graph.db` (verified by `getMetadata(db).commitSha` changing).

**Closeout gate:**
- All four phase gates above exit 0.
- `tracks.md` entry updated to "Active" → "Archived" only after acceptance subagent signs off.
- No `measure/archive/...` paths are referenced from any committed test file (A9 guard).

---

## 3. Fixtures, mocks, and live-behavior proof

| Concern | Approach |
|---|---|
| ts-morph project | Reuse `graphing-tools/fixtures/sample-project/`. **Do not** add new TS source. |
| In-memory DB | `:memory:` per test; `createSchema` applies the new `schema_version` row immediately. |
| Git fixture | Temp dir + manual `.git/hooks/` mkdir; no real `git init` is needed. Tests of hook *content* are unit-level; the smoke test in Phase 4 is the only live `git commit` invocation. |
| stderr/warning capture | Spy on `console.warn` via `const warnings: string[] = []; const origWarn = console.warn; console.warn = (m) => warnings.push(String(m));` in `beforeEach`, restore in `afterEach`. The conflict-resolution tests (U6, U7) and H4 inspect `warnings[]` for exact substring matches — **not** regex on bare words (A7 guard). |
| Hook script content tests | Compare against exact-substring expectations, not regex matches. Assert shebang `#!/bin/sh` is the first line; assert no `bash`-only constructs (`[[`, `local`, etc.) by searching for those tokens and asserting absence — labeled count `bashisms_found:0`. |
| `commit_sha` value | Caller-supplied (e.g. `git rev-parse HEAD` invoked by the CLI layer, not by `runUpdate`). `runUpdate` is pure: it accepts an optional `commitSha` option. Tests pass a synthetic SHA (`'abc1234'`) — no real git shell-out from unit tests. |
| Live-behavior proof | The Phase 4 smoke test is the only "live" proof. It is documented separately and is **not** part of the `bun test` suite. Its evidence is appended to `measure/tracks/<id>/evidence.md` as a labeled `Smoke:install-hooks-fires:1` line. |

---

## 4. Architecture guardrails and changed-contract risks

- **`createSchema` is idempotent.** Phase 1 must use `CREATE TABLE IF NOT EXISTS` and `INSERT OR REPLACE` semantics for `meta`. `schema.test.ts` already asserts idempotency — must remain green.
- **`updateFiles` signature is load-bearing.** Existing test (`update.test.ts` L23–L41) calls `updateFiles(db, project, [filePath])` and the existing `cli.ts` may already wire it. Phase 3 may NOT change the existing signature; instead, it adds a new entry point `runUpdate(db, project, files, options?)` that delegates to `updateFiles` after the conflict-detection check. The existing 3 tests in `update.test.ts` MUST keep passing without modification.
- **`Subcommand` union expansion** is a contract change: every place that switches on `Subcommand` in `cli.ts`/`commands.ts` must handle `"install-hooks"` (TS exhaustiveness check will catch this in Phase 1 — `bunx tsc --noEmit`).
- **POSIX-only hook scripts.** Phase 3 generated content is asserted by hooks.test.ts to contain `#!/bin/sh` and to NOT contain `[[`, `local `, `function `, `${` (which is portable but `$(...)` is preferred — assert presence of `$(...)` not backticks).
- **DB-delete on conflict fallback** is destructive. The implementation must use `fs.unlinkSync(dbPath)` AFTER closing the DB handle. The U6/U7 tests run on `:memory:` so they do NOT exercise the unlink path; a separate `update.test.ts` test with a temp on-disk DB file MUST cover the actual unlink + re-scan path. Add as **U8** to the Phase 2 Red list (corrected: 14 new failing tests, not 13). Re-stated:
  - **U8** — Conflict fallback on disk: create temp file `tmp/graph.db`, write `meta.schema_version = 'v0-bogus'`, call `runUpdate(dbPath, project, [file], { currentVersion: 'v1' })`; assert (a) file at `tmp/graph.db` was recreated (mtime newer than test start), (b) `getMetadata` of the new DB shows `schemaVersion === 'v1'`, (c) `warnings[]` contains `Graph state diverged`.

> **Phase 2 Red count is therefore 14, not 13.** The Mid-Red agent must enumerate them and produce `Phase2:NewTestsRed:14`.

---

## 5. Intentionally-red aggregate-suite handling

Between Phase 2 (Red) and Phase 3 (Green), the aggregate suite `CI=true bun test` will be red. The orchestrator must:

- Capture the failure list from the Red phase as `Phase2:NewTestsRed:14` (labeled integer, A3 guard).
- During Phase 3, the count of remaining-red tests from the Red set monotonically decreases: track G1 → 6 remaining, G2 → 2 remaining, G4 → 0 remaining. Each intermediate state is acceptable; the closeout gate requires 0.
- The pre-existing 172-test count must not drop. Track as `Baseline:PreExistingPassing:172` in the Red phase; assert `>= 172` in every subsequent run.

---

## 6. Artifact tests vs live-behavior tests

| Test class | What it proves | Examples |
|---|---|---|
| **Artifact / documentation** | A function returns a structurally correct value (interface shape, generated string content, DB row count). | C1, C2, H1 (script content), U1, U5. |
| **Live behavior (in-process)** | A function actually mutates an in-memory DB and the mutation is queryable. | U2, U3, U4, U6, U7. |
| **Live behavior (on-disk)** | A function mutates the filesystem (DB file, hook file). | U8, H3 (byte-identity check on disk), H4 (`.bak` file creation). |
| **Live behavior (real git)** | A real `git commit` invokes the installed hook. | Phase 4 smoke test only. Out of `bun test`. |

The strategy MUST NOT collapse these classes — a passing artifact test does not imply live behavior, per Measure's anti-vacuous discipline.

---

## 7. Anti-pattern coverage (per phase)

Anti-patterns from `measure/anti-patterns.md` (A1–A10). Each phase lists the A-IDs it defends and the defense pattern.

### Phase 1 — Contract & Schema

| A-ID | Risk | Defense |
|---|---|---|
| A3 | A tsc-error count could be reported as bare digits ("3 errors") | Mid-Red agent reports `Phase1:tscErrors:N` as a labeled integer parsed from `tsc --noEmit` output `Found ([0-9]+) errors?`. |
| A4 | A Phase 1 with 0 contract changes could vacuously pass | Closeout gate requires (a) `GraphMetadata` interface present in `contract.ts` (grep for exact `export interface GraphMetadata`), (b) `meta` table contains a `schema_version` row after `createSchema` on a fresh `:memory:` DB. Both are explicit existence checks, not "no errors reported". |
| A5 | Plan text could claim "schema migration done" while `schema.test.ts` is red | Closeout gate runs `CI=true bun test graphing-tools/schema.test.ts` and requires exit 0; the plan checkbox may only be ticked after the test exits 0. |
| A6 | The `tracks.md` row could be marked "Phase 1 done" while tsc is red | tracks.md row update is gated on `bunx tsc --noEmit` exit 0. |

### Phase 2 — Tests Red Phase

| A-ID | Risk | Defense |
|---|---|---|
| A3 | Counting failing tests by `[0-9]+` in bun's output is fragile | Parse bun's structured exit: `[[:space:]]([0-9]+)[[:space:]]fail` and store as `Phase2:NewTestsRed:14`. Refuse closeout if the count is not exactly 14 (the planned Red-set size). |
| A4 | A new test could `expect(true).toBe(true)` | Every new test must contain at least one assertion against a value produced by `runUpdate`, `installHooks`, or the DB. The Mid-Red agent enforces by grepping each new test for `expect(.*` and rejecting any test whose only assertion is `expect(true|false|null|undefined)`. |
| A6 | Plan checkboxes for Phase 2 could be ticked while tests don't exist | Closeout gate runs `bun test --list-tests graphing-tools/update.test.ts graphing-tools/hooks.test.ts graphing-tools/contract.test.ts` and asserts each described test ID (U1–U8, H1–H4, C1–C2) appears as a registered test name. 14 IDs, 14 tests. |
| A7 | An exclusion filter in a stderr-assertion could swallow a real warning | All `warnings[]` substring checks use exact strings like `"Graph state diverged"` — no English filter words like "never"/"don't". |

### Phase 3 — Implementation Green Phase

| A-ID | Risk | Defense |
|---|---|---|
| A3 | Coverage % could match `[0-9]+` on incidental output | Coverage extracted from `bun test --coverage --coverage-reporter=json` and parsed as labeled JSON field `summary.lines.pct >= 80`. |
| A4 | Green could be claimed when 0 new tests passed (i.e., new tests were deleted instead of fixed) | Closeout gate re-runs `bun test --list-tests` and asserts the 14 new test names are still registered AND all 14 are in the `"pass"` set. |
| A5 | Plan could say "G1 implemented" while U1 is red | Each G1/G2/G4 task closeout requires its specific test subset to exit 0 (asserted by a per-task `bun test` invocation). |
| A6 | `tracks.md` could claim "schema-conflict resolution working" while U6/U7 are red | The tracks.md note for this track is gated on U6, U7, U8 all green. |
| A10 | `measure/generated/architecture.json` will drift because a new module (`installHooks.ts`) was added | Phase 4 explicitly runs `./measure/generate.sh` and `git diff --exit-code measure/generated/`. Defense: the doctor pre-commit hook (if installed) regenerates; absent the hook, Phase 4 fails closed. |

### Phase 4 — Coverage, Generated Docs, Doctor & Install

| A-ID | Risk | Defense |
|---|---|---|
| A3 | Coverage % parsed from a year/date | Parse JSON coverage output, never plain stdout. |
| A5 | "Build succeeded" could be claimed when `bun run build` exited non-zero | Phase 4 captures exit code; closeout requires `0`. |
| A6 | tracks.md "Done" while doctor is red | Gated on `./measure/doctor.sh` exit 0. |
| A9 | A test references `measure/archive/<id>/` for a not-yet-archived track | Defense: `rg -F 'measure/archive/' graphing-tools/` must return 0 hits in the closeout check. |
| A10 | `measure/generated/architecture.json` drifts because `installHooks.ts` was added | `./measure/generate.sh` must run before the closeout commit and `git diff --exit-code measure/generated/` must be clean. |

---

## 8. Test isolation invariants

- Every test creates `new Database(":memory:")` (or a fresh tmp file path for U8) — never reuses across tests.
- Every git-fixture test uses `os.tmpdir() + '/' + crypto.randomUUID() + '/'` — never a fixed path.
- `afterEach` does `db.close()` and `fs.rmSync(tmpDir, { recursive: true, force: true })`.
- `console.warn` spy is installed in `beforeEach`, restored in `afterEach`. No leakage between tests.
- No test depends on the order of execution (verified by `bun test --rerun=3` in Phase 4).

---

## 9. Coverage targets

`bun test --coverage --coverage-reporter=json`. Per-module thresholds:

| Module | Target | Justification |
|---|---|---|
| `graphing-tools/update.ts` | ≥ 80% lines | Spec G3 requirement |
| `graphing-tools/installHooks.ts` (new) | ≥ 80% lines | Spec G2 requirement |
| `graphing-tools/meta.ts` | ≥ 80% lines | Touched in Phase 1 (`getMetadata`/`setMetadata`) |
| `graphing-tools/contract.ts` | n/a (type-only) | TS interfaces have no runtime branches |
| `graphing-tools/schema.ts` | ≥ 80% lines | Touched in Phase 1 (`meta` columns, `schema_version` insert) |

Coverage failures fail Phase 4 closeout.

---

## 10. Summary of falsification conditions

Every test described above has a single falsification condition:

| Test | Falsifies by |
|---|---|
| U1 dangling-edge cleanup | Editing `update.ts` L26 to delete only by source: edge with dangling target survives ⇒ U1 red. |
| U2 empty-list fallback | Returning `stats = { filesUpdated: 0, ... }` when `filePaths.length === 0` ⇒ U2 red. |
| U3 deleted file | Removing the `existsSync` branch (L38–L44) ⇒ U3 red. |
| U4 renamed file | Failing to handle both paths in a single transaction ⇒ U4 red. |
| U5 commit_sha | Failing to call `setMetadata(db, { commitSha })` ⇒ U5 red. |
| U6 schema mismatch | Skipping the version check ⇒ U6 red. |
| U7 missing `meta` table | Catching the SQLite error and silently continuing ⇒ U7 red. |
| U8 on-disk fallback | Failing to delete and re-create the DB file ⇒ U8 red. |
| H1/H2 hook content | Generating a hook missing the required `git diff` invocation ⇒ red. |
| H3 idempotency | Returning a different `overwritten` set on the second run ⇒ red. |
| H4 backup warning | Failing to detect non-repo-graph content ⇒ red. |
| C1 `GraphMetadata` shape | Dropping `schemaVersion` or `commitSha` field ⇒ red at tsc time. |
| C2 `'install-hooks'` subcommand | Forgetting to extend the `Subcommand` union ⇒ red at tsc time. |

If any test cannot be made to fail by a plausible incorrect implementation, it must be rewritten or deleted.

---

## Handoff

Next: **Mid-Red for Phase 1**. The Mid-Red agent's job is to add the `GraphMetadata` interface skeleton and the `getMetadata`/`setMetadata` stubs to the contract — surface enough types to make `contract.test.ts` (C1, C2) compile but still fail at runtime, and ensure `bunx tsc --noEmit` exits non-zero on the Phase 1 entry.
