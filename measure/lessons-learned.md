# Lessons Learned

> This file is curated working memory, not an append-only log. Keep it at or below **50 lines**.
> Remove or condense entries that are no longer relevant to near-term planning.

## Architecture & Design

- (2026-05-24, graphdb_20260524) **Do not inherit product specs from external projects.** `product.md` and `tech-stack.md` were copied from the "Understand Anything" plugin spec, describing a JSON-to-SQLite companion tool. This repo is standalone. The resulting `build-graph-db.ts` read JSON input — completely wrong for a tool that should scan TypeScript directly. Always verify product context is intrinsic to the repo, not inherited from adjacent projects.

## Recurring Gotchas

- (2026-06-24, agent_explore_freshness_impact_20260622) **Defer scan-time wiring, not contracts.** When adding FTS5 or new file-metadata tables, expose a `syncNodeFts` / `recordFileMetadata` helper in the schema/index layer and wire bulk-scan callers in a follow-up track. The contract is testable in isolation; the bulk caller-side wiring stays out of the critical path. Avoid expanding scope into "rewrite every scan entrypoint" inside a single track.

- (2026-06-24, agent_explore_freshness_impact_20260622) **Path-anchored globs beat bare-word filters for test classifiers.** An `affected` classifier that grep'd English words like "test" misclassifies helpers. Path-anchored globs (`*.test.ts`, `__tests__/**`, `e2e/**`) plus a fixture that proves non-misclassification satisfy anti-pattern A7 and lock the contract.

## Patterns That Worked Well

- (2026-06-24, agent_explore_freshness_impact_20260622) **Document `deferral:` markers explicitly in plan tasks.** When a Red test cannot be made green within a Phase 3 task (e.g. FTS5 `'delete'` command unsupported on `bun:sqlite`'s contentless FTS tables), document the per-test adjustment under "Test adjustments during Green (necessary)" and pin the behavior in a still-green assertion. Reviewers can audit the diff without re-deriving the rationale.

## Planning Improvements
