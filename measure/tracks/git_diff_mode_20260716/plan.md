# Implementation Plan: Git Diff Mode — Changed Nodes/Edges and Blast Radius

Features are implemented in dependency order: git-ref discovery first, then classification, then blast radius, then the staleness guard. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Git-Ref Discovery (D1)

- [ ] Task: Define diff command contract
    - [ ] Document CLI signature `repo-graph diff <db> <git-ref> [--committed] [--json] [--depth N] [--scope <dir>] [--strict]` in `graphing-tools/README.md`
    - [ ] Document the `--json` output schema (D2) as the frozen contract
- [ ] Task: Tests D1 — git-ref discovery (`diff.test.ts`, Red)
    - [ ] Add: valid ref returns changed file list from `git diff --name-only`
    - [ ] Add: `--committed` switches to `<ref> HEAD` comparison
    - [ ] Add: deleted files appear with status `removed`
    - [ ] Add: rename entries map old and new paths
    - [ ] Add: non-TS changes counted as ignored
    - [ ] Add: invalid ref exits 2 with actionable message
    - [ ] Add: non-git CWD exits 2 with actionable message
- [ ] Task: Implement D1 git-ref discovery (Green)
    - [ ] Add `diff.ts` with quoted-argv git invocation (no shell interpolation)
    - [ ] Wire `diff` subcommand into `cli.ts` parsing
- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Change Classification (D2)

- [ ] Task: Tests D2 — classification (Red)
    - [ ] Add: untracked-but-scanned file classifies `added`
    - [ ] Add: deleted file classifies `removed` with former node count
    - [ ] Add: edited function yields `modified` with correct per-node added/removed/changed counts
    - [ ] Add: classification performs no DB writes (assert DB mtime unchanged)
    - [ ] Add: `--json` output matches the Phase 1 schema contract
- [ ] Task: Implement D2 classification (Green)
    - [ ] Reuse the incremental `update` comparison path against an in-memory fresh parse
    - [ ] Emit human summary table and `--json` report
- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Blast Radius & Staleness Guard (D3, D4)

- [ ] Task: Tests D3 — blast radius (Red)
    - [ ] Add: default one-hop dependents grouped by file, sorted by dependent count desc
    - [ ] Add: `--depth 3` transitive output matches `impact` for the same seed set
    - [ ] Add: `--scope` filters reported files by path prefix
    - [ ] Add: test-file dependents listed separately from source dependents (A7 globs)
- [ ] Task: Tests D4 — staleness guard (Red)
    - [ ] Add: stale file (DB scan older than mtime) triggers stderr warning
    - [ ] Add: `--strict` exits 1 when any diffed file is stale
    - [ ] Add: warning text includes the `repo-graph update` remediation command
- [ ] Task: Implement D3 + D4 (Green)
- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

---

## Phase 4 — Acceptance & Hardening

- [ ] Task: Run full acceptance criteria from spec.md against this repo
- [ ] Task: Performance check — 50-commit ref, ≤500 changed files, < 30s
- [ ] Task: Full test suite + lint green; update `graphing-tools/README.md` command list
- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
