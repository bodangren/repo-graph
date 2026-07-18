# Spec: Git Diff Mode — Changed Nodes/Edges and Blast Radius

## Overview

Feature request #6 in `build-graph-feature-requests.md`: `repo-graph diff graph.db HEAD~5` should answer *"which nodes/edges changed in the last 5 commits and what's the blast radius?"*. For large migrations where 200+ files move, this is the missing safety net. The graph already supports `affected` (changed-file impact analysis) and `impact` (transitive dependents); this track composes them into a first-class `diff` command driven by git history instead of a hand-supplied file list.

---

## Functional Requirements

### D1 — Git-Ref File Discovery

Add `repo-graph diff <db> <git-ref>` that resolves the set of changed files between `<git-ref>` and the working tree (or `HEAD` with `--committed`).

**Behavior:**
- Uses `git diff --name-only <ref>` (uncommitted-inclusive) or `git diff --name-only <ref> HEAD` when `--committed` is passed.
- Deleted files are included and reported separately (their nodes are stale in the DB).
- Renames are followed via `git diff --name-status` `R` entries; both old and new paths are mapped.
- Non-`.ts`/`.tsx` changes are reported as ignored (count only).
- Exits with code 2 and a clear error when `<git-ref>` is not a valid revision or the CWD is not inside a git work tree.

### D2 — Change Classification Report

For each changed file, classify the graph delta using the stored node hashes and the current scan.

**Classifications:**
- `added` — file has no nodes in the DB.
- `removed` — file's nodes exist in the DB but the file is gone from disk.
- `modified` — file exists in both; report per-node `added` / `removed` / `changed` counts by diffing stored nodes against a fresh parse of the file (reuse the incremental `update` comparison path; do not write to the DB).

**Output (human):** per-file summary table plus totals (nodes added/removed/changed, edges added/removed).

**Output (`--json`):** stable schema `{ ref, files: [{ path, status, nodes: { added, removed, changed }, edges: { added, removed } }], totals }`.

### D3 — Blast-Radius Traversal

Combine the changed-node set with the existing `impact` traversal to report the blast radius.

**Behavior:**
- Default: one-hop dependents of every changed node, grouped by file, sorted by dependent count descending.
- `--depth N`: transitive dependents up to N hops (cap 10; warn above).
- `--scope <dir>`: restrict reported blast-radius files to a path prefix.
- Report distinguishes direct dependents from test-file dependents (path-anchored globs: `*.test.ts`, `__tests__/**`, `e2e/**`), per the A7 classifier lesson.

### D4 — Staleness Guard

Warn (stderr, non-zero exit only with `--strict`) when the DB scan timestamp for a changed file is older than the file's mtime, i.e. the graph is stale for the diffed set. The warning lists the stale files and the `repo-graph update` command that refreshes them.

---

## Non-Functional Requirements

- The command never writes to the database (read-only; fresh parses happen in memory).
- Performance: diff against a 50-commit ref touching ≤500 files must complete in < 30s on this repo.
- All existing tests pass without modification.
- Git invocation must be POSIX-safe: ref and paths passed as quoted argv (no shell interpolation), per the hook-generation lesson.

---

## Acceptance Criteria

- [ ] `repo-graph diff graph.db HEAD~1` after a one-function edit reports the edited file as `modified` with the correct per-node counts.
- [ ] A deleted file is reported as `removed` and its blast radius lists its former importers.
- [ ] `--json` output parses and matches the documented schema (contract test).
- [ ] `--depth 3` transitive blast radius matches `impact` output for the same seed set.
- [ ] Test-file dependents are listed separately from source dependents.
- [ ] Invalid ref exits 2 with an actionable error message.
- [ ] Stale-DB warning fires on a touched-but-not-rescanned file; `--strict` exits 1 in that case.

---

## Out of Scope

- Cross-ref graph snapshots (DB stores current state only; historical graph reconstruction is a separate track).
- Line-level (hunk) attribution of changes — node granularity is sufficient.
- Diffing two arbitrary DB files (`diff db1 db2`).
- Watching/polling mode.
