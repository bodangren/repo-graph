# Lessons Learned

> This file is curated working memory, not an append-only log. Keep it at or below **50 lines**.
> Remove or condense entries that are no longer relevant to near-term planning.

## Architecture & Design

- (2026-05-24, graphdb_20260524) **Do not inherit product specs from external projects.** `product.md` and `tech-stack.md` were copied from the "Understand Anything" plugin spec, describing a JSON-to-SQLite companion tool. This repo is standalone. The resulting `build-graph-db.ts` read JSON input — completely wrong for a tool that should scan TypeScript directly. Always verify product context is intrinsic to the repo, not inherited from adjacent projects.

## Recurring Gotchas

- (2026-06-24, agent_explore_freshness_impact_20260622) **Defer scan-time wiring, not contracts.** When adding FTS5 or new file-metadata tables, expose a `syncNodeFts` / `recordFileMetadata` helper in the schema/index layer and wire bulk-scan callers in a follow-up track. The contract is testable in isolation; the bulk caller-side wiring stays out of the critical path. Avoid expanding scope into "rewrite every scan entrypoint" inside a single track.

- (2026-06-24, agent_explore_freshness_impact_20260622) **Path-anchored globs beat bare-word filters for test classifiers.** An `affected` classifier that grep'd English words like "test" misclassifies helpers. Path-anchored globs (`*.test.ts`, `__tests__/**`, `e2e/**`) plus a fixture that proves non-misclassification satisfy anti-pattern A7 and lock the contract.

## Patterns That Worked Well

- (2026-07-22, scanner_memory_scalability_20260722) **Bound compiler worlds before micro-optimizing traversal.** Indexed symbol lookup removed superlinear work but still missed the real-monorepo gate. Deepest-tsconfig ownership, syntax-only 32-file Projects, AST-free global resolution, and atomic path-based persistence cut peak RSS by 50.7%. Stage-level stderr telemetry and two normalized full scans made the performance result auditable without changing stdout.

- (2026-06-24, agent_explore_freshness_impact_20260622) **Document `deferral:` markers explicitly in plan tasks.** When a Red test cannot be made green within a Phase 3 task (e.g. FTS5 `'delete'` command unsupported on `bun:sqlite`'s contentless FTS tables), document the per-test adjustment under "Test adjustments during Green (necessary)" and pin the behavior in a still-green assertion. Reviewers can audit the diff without re-deriving the rationale.

- (2026-06-25, git_hook_incremental_updates_20260528) **POSIX shell scripts from a TS template: quote every parameter, never trust `$1`/`$2` are set.** The generated `post-checkout` script invokes `git diff --name-only "$1" "$2"`. Without the quotes, an empty positional arg would collapse to one token and break the diff invocation. The `pre-commit` script uses `$(git diff --cached --name-only --diff-filter=ACM)` — a subshell expansion — and the explicit `--diff-filter=ACM` skips deleted files. The test suite (`hooks.test.ts` H6/H7) asserts both the `$(...)` form is used and that bashisms like `[[` and `local ` are absent, which is the falsifiable contract for the POSIX-only requirement.

- (2026-06-25, git_hook_incremental_updates_20260528) **Generate-then-rename beats direct write for hook installation.** `installHooks` writes the hook content to `<path>.tmp.<pid>` first, then `fs.renameSync` over the target. This avoids leaving a half-written `pre-commit` on the filesystem if the process is interrupted mid-write. The fallback (direct write) handles cross-device renames; the `.tmp` cleanup is best-effort. Reviewers should look for the same pattern when adding other config-file writers.

## Planning Improvements
