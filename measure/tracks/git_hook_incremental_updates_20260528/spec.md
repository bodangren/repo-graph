# Spec: Git Hook Integration for Incremental Graph Updates

## Overview

Currently, `repo-graph scan` performs a full rebuild of the knowledge graph from scratch. On large codebases this is slow, and developers often forget to re-scan after making changes. This track wires `repo-graph update` into git lifecycle hooks so the `graph.db` stays synchronized automatically with code changes.

The integration supports:
- **Pre-commit hook**: runs `repo-graph update` with the staged file list before the commit is finalized.
- **Post-checkout hook**: runs `repo-graph update` with the full changed-file list after switching branches.
- **Hook installation CLI**: a one-command setup that installs hooks into `.git/hooks/`.
- **Conflict resolution**: when multiple branches modify the graph independently, the tool detects divergent graph states and falls back to a full rescan.

---

## Functional Requirements

### G1 — Incremental Update Command

Add a new `repo-graph update <db> [files...]` command that updates the graph incrementally instead of rebuilding from scratch.

**Behavior:**
- For each changed file path provided:
  - Remove all existing nodes whose `file_path` matches the changed file.
  - Remove all edges where either `source` or `target` was a removed node.
  - Re-scan the changed file and insert new nodes and edges.
- If no file list is provided, fall back to a full scan.
- Update the `metadata` table with the latest scan timestamp and git commit SHA.

### G2 — Hook Installation CLI

Add `repo-graph install-hooks [--path <git-dir>]` that writes hook scripts into `.git/hooks/` (or the path provided).

**Generated hooks:**
- `pre-commit`: runs `repo-graph update graph.db $(git diff --cached --name-only --diff-filter=ACM)`
- `post-checkout`: runs `repo-graph update graph.db $(git diff --name-only $1 $2)`

**Idempotency:** Running `install-hooks` twice overwrites the existing scripts (with a warning if non-repo-graph content is detected).

### G3 — File-Change Detection

The update command must accurately map changed files to their graph entries.

**Edge cases:**
- Renamed files: treat as remove old path + add new path.
- Deleted files: remove all nodes for that `file_path`.
- New files: scan and insert normally.
- Untracked files: ignore unless explicitly passed.

### G4 — Conflict Resolution

When a branch switch or merge changes the graph in ways that cannot be incrementally reconciled (e.g., schema version mismatch, missing `metadata` table), the tool must:

1. Detect the conflict by comparing the `metadata` table's `schema_version` and `commit_sha`.
2. Print a warning: `Graph state diverged — falling back to full scan`.
3. Delete the existing database and run a full `repo-graph scan`.

---

## Non-Functional Requirements

- Incremental updates on a single file must complete in < 500ms.
- Hook scripts must be POSIX-compliant shell (no bashisms) so they work in minimal CI containers.
- Hook installation must be reversible — document how to `rm .git/hooks/pre-commit .git/hooks/post-checkout`.
- All existing tests pass without modification.
- New tests must cover hook generation, incremental update logic, and conflict fallback (≥ 80% coverage on new modules).

---

## Acceptance Criteria

- [ ] `repo-graph update graph.db src/utils.ts` removes old nodes for `src/utils.ts`, re-scans it, and inserts fresh nodes.
- [ ] `repo-graph install-hooks` creates `.git/hooks/pre-commit` and `.git/hooks/post-checkout`.
- [ ] Committing a staged TypeScript file triggers an incremental update automatically.
- [ ] Switching branches triggers an incremental update with the correct file list.
- [ ] When the database schema version does not match the CLI version, a full rescan is performed and a warning is printed.
- [ ] Existing 172 tests continue to pass.

---

## Out of Scope

- Post-merge hook (can be added later; post-checkout covers most branch workflows).
- Merge-driver integration for `graph.db` as a binary merge target.
- Watch-mode file monitoring (inotify/fsevents) — deferred to a follow-up track.
- Signed commits / GPG hook interaction (assumed compatible).
