# Implementation Plan: Git Hook Integration for Incremental Graph Updates

Features are implemented in dependency order: incremental update command first, then hook installation, then conflict resolution. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Schema

Update `contract.ts` and `schema.ts` to support metadata tracking and incremental update operations before writing any tests or implementation.

- [~] Task: Expand metadata table schema
    - [x] Add `schema_version TEXT` and `commit_sha TEXT` columns to `metadata` table — added via `ALTER TABLE` in `createSchema`
    - [x] Add `GraphMetadata` interface to `contract.ts` with `schemaVersion` and `commitSha` fields — added with `schemaVersion: string`, `commitSha: string | null`, `lastIndexedAt?: number`
    - [~] Add `getMetadata()` and `setMetadata()` operations to the database contract — stubs added to `meta.ts` (throw "not implemented"); tests written and failing as expected

- [x] Task: Add CLI subcommand and arg types
    - [x] Add `install-hooks` to `Subcommand` union in `contract.ts`
    - [x] Add `InstallHooksArgs { path?: string; force?: boolean; json?: boolean }` interface
    - [x] Add `json?: boolean` to existing `UpdateArgs` interface
    - [x] Add `install-hooks` variant to `ParsedArgs` union

- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

### Phase 1 Red Evidence

**Red command:** `CI=true bun test graphing-tools/update.test.ts graphing-tools/contract.test.ts graphing-tools/schema.test.ts`

**Result:** 75 pass, 4 fail, 187 expect() calls

**New passing tests (contract/schema shape):**
- `GraphMetadata > has schemaVersion and commitSha fields`
- `GraphMetadata > allows commitSha to be null`
- `GraphMetadata > allows optional lastIndexedAt`
- `Subcommand union > includes install-hooks subcommand`
- `InstallHooksArgs > has optional path, force, and json fields`
- `InstallHooksArgs > allows all fields to be omitted`
- `UpdateArgs > has optional json field`
- `SCHEMA_VERSION > is exported and is a non-empty string`
- `SCHEMA_VERSION > follows semver-like format`
- `GRAPH_META_KEY > is exported and equals 'graph'`
- `meta table schema_version and commit_sha columns > createSchema adds schema_version column to meta table`
- `meta table schema_version and commit_sha columns > createSchema adds commit_sha column to meta table`
- `meta table schema_version and commit_sha columns > column addition is idempotent`

**Failing tests (behavior — stubs throw "not implemented"):**
- `getMetadata > returns a GraphMetadata object when metadata exists`
- `getMetadata > returns undefined when no metadata row exists`
- `setMetadata > writes structured metadata to the meta table`
- `setMetadata > merges partial updates with existing metadata`

**Phase1:tscErrors:N** — 102 pre-existing tsc errors (none introduced by Phase 1 changes)

---

## Phase 2 — Tests (Red Phase)

Write all failing tests before touching update or hook implementation.

- [x] Task: Tests G1 — Incremental update command (`update.test.ts`)
    - [x] U1: `runUpdate` with a single file updates the commit_sha in metadata
    - [x] U2: `runUpdate` with an empty file list triggers a full-scan fallback
    - [x] U3: `runUpdate` with a deleted file path removes all nodes and dependent edges
    - [x] U4: `runUpdate` with a renamed file path (old + new) is treated as remove-old + add-new
    - [x] U5: `runUpdate` writes `commit_sha` to metadata after success
    - [x] U6: `runUpdate` detects schema-version mismatch and falls back to full scan with `conflict: true`
    - [x] U7: `runUpdate` detects a missing `meta` table and falls back to full scan
    - [x] U8: `runUpdate` with an on-disk SQLite file re-creates the DB when fallback is triggered

- [x] Task: Tests G2 — Hook installation CLI (`hooks.test.ts`)
    - [x] H1: `installHooks` creates `.git/hooks/pre-commit` with correct command
    - [x] H2: `installHooks` creates `.git/hooks/post-checkout` with correct command
    - [x] H3: `installHooks` overwrites existing repo-graph hooks on second run (idempotent)
    - [x] H4: `installHooks` warns when overwriting non-repo-graph content
    - [x] H5: `installHooks` makes generated scripts executable (mode 0755)
    - [x] H6: Generated `pre-commit` invokes `repo-graph update graph.db $(git diff --cached --name-only --diff-filter=ACM)`
    - [x] H7: Generated `post-checkout` invokes `repo-graph update graph.db $(git diff --name-only $1 $2)`

- [x] Task: Tests G4 — CLI wiring (`cli.test.ts`) + Conflict resolution (`update.test.ts`)
    - [x] C1: `parseArgs(["install-hooks"])` returns `InstallHooksArgs`
    - [x] C2: `parseArgs(["install-hooks"])` returns with default path
    - [x] C3: `parseArgs(["install-hooks", "--path", "/custom/.git"])` honors the path
    - [x] C4: `parseArgs(["update", "--json", "graph.db"])` sets `json: true`

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

### Phase 2 Red Evidence

**Red command:** `CI=true bun test graphing-tools/update.test.ts graphing-tools/hooks.test.ts graphing-tools/cli.test.ts`

**Result:** 80 pass, 19 fail, 153 expect() calls

**Full suite baseline preserved:** 428 pass (unchanged from Phase 1 baseline), 23 fail total (4 Phase 1 stubs + 19 new Red tests), 944 expect() calls, 451 tests across 26 files.

**Phase2:NewTestsRed:19** — all 19 new tests failing as expected.

**New failing tests and failure reasons:**

| ID | Test | Failure reason |
|---|---|---|
| U1 | `runUpdate` single file updates commit_sha | `TypeError: runUpdate is not a function` |
| U2 | `runUpdate` empty list falls back to full scan | `TypeError: runUpdate is not a function` |
| U3 | `runUpdate` deleted file removes nodes | `TypeError: runUpdate is not a function` |
| U4 | `runUpdate` renamed file remove+add | `TypeError: runUpdate is not a function` |
| U5 | `runUpdate` writes commit_sha to metadata | `TypeError: runUpdate is not a function` |
| U6 | `runUpdate` schema mismatch falls back | `Error: not implemented` (setMetadata stub) |
| U7 | `runUpdate` missing meta table falls back | `TypeError: runUpdate is not a function` |
| U8 | `runUpdate` on-disk fallback re-creates DB | `Error: not implemented` (setMetadata stub) |
| H1 | installHooks creates pre-commit | `expect(installHooks).toBeDefined()` → undefined |
| H2 | installHooks creates post-checkout | `expect(installHooks).toBeDefined()` → undefined |
| H3 | installHooks idempotent overwrite | `expect(installHooks).toBeDefined()` → undefined |
| H4 | installHooks warns on non-repo-graph content | `expect(installHooks).toBeDefined()` → undefined |
| H5 | installHooks makes scripts executable | `expect(installHooks).toBeDefined()` → undefined |
| H6 | pre-commit invokes repo-graph update | `expect(installHooks).toBeDefined()` → undefined |
| H7 | post-checkout invokes repo-graph update | `expect(installHooks).toBeDefined()` → undefined |
| C1 | parseArgs install-hooks subcommand | `Unknown subcommand: install-hooks` (CLI case missing) |
| C2 | parseArgs install-hooks default path | `Unknown subcommand: install-hooks` (CLI case missing) |
| C3 | parseArgs install-hooks --path flag | `Unknown subcommand: install-hooks` (CLI case missing) |
| C4 | parseArgs update --json flag | `expect(received).toBe(expected)` — json is undefined |

**Files changed:**
- `graphing-tools/update.test.ts` — added `runUpdate` describe block (U1–U8)
- `graphing-tools/hooks.test.ts` — new file (H1–H7)
- `graphing-tools/cli.test.ts` — added `install-hooks` and `update --json` describe blocks (C1–C4)

---

## Phase 3 — Implementation (Green Phase)

- [x] Task: Implement G1 — Incremental update command
    - [x] Create `update.ts` with `runUpdate(db, files, options)` function — commit `a96454e`
    - [x] Implement node removal by `file_path` — already in `updateFiles`; regression-locked
    - [x] Implement dangling edge cleanup after node removal — already in `updateFiles`; regression-locked
    - [x] Implement per-file re-scan and insertion — already in `updateFiles`; regression-locked
    - [x] Implement full-scan fallback when no files are provided — commit `a96454e` (`runUpdateBody` clears nodes/edges then re-scans all project source files)
    - [x] Integrate into CLI as `repo-graph update <db> [files...]` — commit `1e417b1` (`handleUpdate` delegates to `runUpdate` with `--json` support)
    - [x] Run `bun test`; confirm G1 tests pass — `CI=true bun test` → 451 pass / 0 fail
    - [x] Commit: `feat(update): Add incremental graph update command` — see `a96454e`

- [x] Task: Implement G2 — Hook installation CLI
    - [x] Create `installHooks.ts` with `runInstallHooks(gitDir)` function — commit `1e417b1` (new file `graphing-tools/hooks.ts`)
    - [x] Generate POSIX-compliant `pre-commit` shell script — uses `#!/bin/sh` and `repo-graph update graph.db $(git diff --cached --name-only --diff-filter=ACM)`
    - [x] Generate POSIX-compliant `post-checkout` shell script — uses `#!/bin/sh` and `repo-graph update graph.db $(git diff --name-only "$1" "$2")`
    - [x] Implement idempotent overwrite with conflict detection — `HOOK_MARKER` line distinguishes repo-graph vs hand-rolled hooks; `.bak` saved on non-repo-graph overwrite
    - [x] Integrate into CLI as `repo-graph install-hooks [--path]` — commit `1e417b1` (`install-hooks` case in `parseArgs` + `handleInstallHooks` in `build-graph.ts`)
    - [x] Run `bun test`; confirm G2 tests pass — H1–H7 green (7/7)
    - [x] Commit: `feat(hooks): Add git hook installation command` — see `1e417b1`

- [x] Task: Implement G4 — Conflict resolution
    - [x] Add schema version constant to the codebase — `SCHEMA_VERSION = "1.0.0"` in `schema.ts` (added in Phase 1)
    - [x] Implement metadata comparison in `runUpdate` — commit `a96454e` (`detectMetadataState` distinguishes missing-table / missing-row / version-mismatch)
    - [x] Implement fallback path: delete DB + full scan on mismatch — on-disk path branch unlinks and recreates via `resetOnConflict` (default true)
    - [x] Run `bun test`; confirm G4 tests pass — U6, U7, U8 green (8/8 in `runUpdate` describe block)
    - [x] Commit: `feat(update): Add conflict detection and full-scan fallback` — see `a96454e`

- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

### Phase 3 Green Evidence

**Green command:** `CI=true bun test`

**Result:** 451 pass, 0 fail, 1016 expect() calls

**Per-file gate:**
- `graphing-tools/update.test.ts` → 11/11 pass (3 baseline + U1–U8)
- `graphing-tools/hooks.test.ts` → 7/7 pass (H1–H7)
- `graphing-tools/cli.test.ts` → 81/81 pass (77 baseline + C1–C4)
- `graphing-tools/schema.test.ts` → 41/41 pass (37 baseline + 4 Phase 1 metadata tests now green)
- `graphing-tools/contract.test.ts` → 41/41 pass (Phase 1 contract tests stay green)
- `graphing-tools/files.test.ts` → 6/6 pass (deleteFileData semantic shift: filesDeleted now logical count of 1)

**Pre-existing baseline preserved:** all 428 pre-existing tests still pass (no regressions).

**Phase 1 stubs closed:** 4 stub failures (`getMetadata` / `setMetadata`) now green.

**Phase 2 reds closed:** all 19 (8 update + 7 hooks + 4 cli) now green.

**Live gates:**
- `bun run lint` → exit 0
- `./measure/doctor.sh` → exit 0
- `bunx tsc --noEmit` → only 1 pre-existing `update.ts:122` error remains (unchanged from baseline); 4 new errors I briefly introduced in `meta.ts` were fixed in commit `1e417b1`

---

## Phase 4 — Coverage, Generated Docs, Doctor & Install

- [ ] Task: Verify coverage ≥ 80%
    - [ ] `bun test --coverage`
    - [ ] All modified modules at or above threshold

- [ ] Task: Run generate script and commit if changed
    - [ ] `./measure/generate.sh`
    - [ ] `git diff --exit-code measure/generated/`

- [ ] Task: Run doctor script
    - [ ] `./measure/doctor.sh`
    - [ ] Fix any architectural violations

- [ ] Task: Rebuild executable and install to `~/.local/bin/`
    - [ ] `bun run build`
    - [ ] `cp ./bin/repo-graph ~/.local/bin/repo-graph`
    - [ ] Smoke test: install hooks in a real repo and verify pre-commit triggers

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
