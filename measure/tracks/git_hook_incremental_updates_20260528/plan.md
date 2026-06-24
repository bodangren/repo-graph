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

- [ ] Task: Tests G1 — Incremental update command (`update.test.ts`)
    - [ ] Add: `update` removes old nodes for a changed file and inserts new ones
    - [ ] Add: `update` removes dangling edges when nodes are deleted
    - [ ] Add: `update` with no file list falls back to full scan
    - [ ] Add: `update` handles deleted files by removing all nodes for that path
    - [ ] Add: `update` handles renamed files as remove + add
    - [ ] Add: `update` writes the current commit SHA to metadata

- [ ] Task: Tests G2 — Hook installation CLI (`hooks.test.ts`)
    - [ ] Add: `install-hooks` creates `.git/hooks/pre-commit` with the correct command
    - [ ] Add: `install-hooks` creates `.git/hooks/post-checkout` with the correct command
    - [ ] Add: `install-hooks` overwrites existing repo-graph hooks on second run
    - [ ] Add: `install-hooks` warns if existing non-repo-graph hook content is detected

- [ ] Task: Tests G4 — Conflict resolution (`update.test.ts`)
    - [ ] Add: `update` detects schema version mismatch and falls back to full scan
    - [ ] Add: `update` prints a warning when falling back to full scan
    - [ ] Add: `update` detects missing metadata table and falls back to full scan

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

- [ ] Task: Implement G1 — Incremental update command
    - [ ] Create `update.ts` with `runUpdate(db, files, options)` function
    - [ ] Implement node removal by `file_path`
    - [ ] Implement dangling edge cleanup after node removal
    - [ ] Implement per-file re-scan and insertion
    - [ ] Implement full-scan fallback when no files are provided
    - [ ] Integrate into CLI as `repo-graph update <db> [files...]`
    - [ ] Run `bun test`; confirm G1 tests pass
    - [ ] Commit: `feat(update): Add incremental graph update command`

- [ ] Task: Implement G2 — Hook installation CLI
    - [ ] Create `installHooks.ts` with `runInstallHooks(gitDir)` function
    - [ ] Generate POSIX-compliant `pre-commit` shell script
    - [ ] Generate POSIX-compliant `post-checkout` shell script
    - [ ] Implement idempotent overwrite with conflict detection
    - [ ] Integrate into CLI as `repo-graph install-hooks [--path]`
    - [ ] Run `bun test`; confirm G2 tests pass
    - [ ] Commit: `feat(hooks): Add git hook installation command`

- [ ] Task: Implement G4 — Conflict resolution
    - [ ] Add schema version constant to the codebase
    - [ ] Implement metadata comparison in `runUpdate`
    - [ ] Implement fallback path: delete DB + full scan on mismatch
    - [ ] Run `bun test`; confirm G4 tests pass
    - [ ] Commit: `feat(update): Add conflict detection and full-scan fallback`

- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

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
