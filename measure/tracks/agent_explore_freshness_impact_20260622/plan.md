# Implementation Plan: Agent Explore, Freshness, and Changed-File Impact

This track imports CodeGraph's best low-hanging product patterns while keeping `repo-graph` specialized for Measure-driven Next.js/Vite TypeScript projects. Work is ordered contract-first: schema and command contracts, tests, implementation, then generated docs and doctor checks. Commit after each top-level task.

---

## Phase 1 — Contract & Schema Definition

Define the durable graph contracts before writing implementation code.

- [x] Task: Define schema additions for FTS and file metadata
    - [x] Add `files` table contract to `schema.ts` with path, hash, size, modified time, indexed time, node count, and errors.
    - [x] Add additive FTS5 contract for `nodes_fts` with fallback behavior documented for SQLite builds without FTS5.
    - [x] Add index contracts for file path, modified time, FTS lookup, and edge traversal patterns used by affected/impact.
    - [x] Document compatibility expectations for existing `graph.db` files.

- [x] Task: Extend CLI contract types
    - [x] Add `explore`, `affected`, and `impact` to `Subcommand`.
    - [x] Define `ExploreArgs`, `AffectedArgs`, and `ImpactArgs`.
    - [x] Define shared freshness, relationship, source snippet, and affected-file JSON payload types.
    - [x] Preserve existing exit-code taxonomy and ambiguity contract.

- [x] Task: Define ranking and output budgets
    - [x] Specify match scoring order for exact node name, file path, FTS rank, tags, and relationship proximity.
    - [x] Specify default limits for matches, relationship fanout, traversal depth, and source snippet lines.
    - [x] Specify truncation metadata and next-query guidance for text and JSON output.

- [x] Task: Define affected/impact traversal semantics
    - [x] Define which edge types count for reverse impact traversal.
    - [x] Define changed-file normalization against `project_root`.
    - [x] Define test-file classifier defaults and `--filter` behavior.
    - [x] Define output group names: tests, routes, components, dataAccess, and other.

- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

### Red-test evidence (Phase 1)

- **Command:** `CI=true bun test graphing-tools/contract.test.ts graphing-tools/schema.test.ts`
- **Result:** 58 pass, 0 fail, 148 expect() calls
- **Contract.ts additions:** `explore`/`affected`/`impact` in `Subcommand` union; `ExploreArgs`, `AffectedArgs`, `ImpactArgs` interfaces; `ExploreOutput`, `AffectedOutput`, `ImpactOutput` payload types; `FileFreshnessEntry`, `FreshnessBlock`, `RelationshipEntry`, `SourceSnippet`, `AffectedFileEntry`, `TruncationMeta` sub-types; `MATCH_SCORING_ORDER`, `OutputLimits`, `IMPACT_TRAVERSAL_EDGE_TYPES`, `TEST_FILE_PATTERNS`, `AFFECTED_GROUP_NAMES` constants.
- **Schema.ts additions:** `files` table DDL (`FILES_TABLE_SQL`), file/edge indexes (`FILES_INDEX_SQL`, `EDGE_TRAVERSAL_INDEX_SQL`), FTS5 virtual table + triggers (`FTS5_CREATE_SQL`, `FTS5_TRIGGERS_SQL`) with defensive try/catch in `createSchema`.
- **New tests:** 45 new shape tests in contract.test.ts (subcommands, args, output types, ranking, traversal); 22 new tests in schema.test.ts (files table, indexes, FTS5 DDL constants, defensive creation).
- **tsc note:** Pre-existing tsc errors in `cli.test.ts`, `commands.ts`, `audit.ts`, `scanner.ts` (unrelated to new code). New contract/schema types compile cleanly under bun's test runner.

---

## Phase 2 — Tests (Red Phase)

Write failing tests for the new contracts before implementing behavior.

- [x] Task: Tests A1 — FTS-backed search
    - [x] Add test that `createSchema` creates the FTS table when supported.
    - [x] Add test that scan/update keep FTS results synchronized with node changes.
    - [x] Add test that `searchNodes` ranks exact/FTS matches above broad substring matches.
    - [x] Add fallback test for environments where FTS5 creation fails.

- [x] Task: Tests A2 — file metadata and freshness
    - [x] Add test that full scan records file metadata and node counts.
    - [x] Add test that incremental update refreshes metadata after content changes.
    - [x] Add test that deleted files remove file metadata, nodes, and dependent edges.
    - [x] Add test that freshness helpers detect modified, deleted, and current files.

- [x] Task: Tests A3 — explore command contract
    - [x] Add CLI parse tests for `explore`.
    - [x] Add integration fixture with Next route, component, hook, and Drizzle-style query.
    - [x] Add text output test for matches, relationships, relative paths, and stale warnings.
    - [x] Add JSON output test for deterministic `matches`, `relationships`, `sourceSnippets`, and `freshness`.

- [x] Task: Tests A4 — affected command contract
    - [x] Add CLI parse tests for file arguments and `--stdin`.
    - [x] Add traversal test from changed source file to downstream components/routes/tests.
    - [x] Add tests-only output test.
    - [x] Add JSON path provenance test showing shortest graph paths.

- [x] Task: Tests A5 — impact command contract
    - [x] Add CLI parse tests for symbol, node ID, and file path roots.
    - [x] Add ambiguity and not-found tests that preserve existing exit codes.
    - [x] Add schema/field impact test for Drizzle-style `queries`, `mutates`, and `param_flow` edges.
    - [x] Add affected-tests summary test.

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

### Red-test evidence (Phase 2)

- **Command:** `CI=true bun test graphing-tools/search.test.ts graphing-tools/meta.test.ts graphing-tools/commands.test.ts graphing-tools/cli.test.ts graphing-tools/integration.test.ts graphing-tools/explore.test.ts graphing-tools/affected.test.ts graphing-tools/impact.test.ts`
- **Result:** 120 pass, 77 fail, 242 expect() calls across 197 tests in 8 files
- **Previously-passing tests:** All 120 existing tests continue to pass (commands.test.ts, cli.test.ts existing, search.test.ts existing, meta.test.ts existing, contract.test.ts, schema.test.ts)
- **New test files:** `explore.test.ts` (13 tests), `affected.test.ts` (11 tests), `impact.test.ts` (15 tests)
- **Extended test files:** `search.test.ts` (+7 A1 tests), `meta.test.ts` (+11 A2 tests), `cli.test.ts` (+24 parse tests for explore/affected/impact)
- **Failure modes:**
  - A1 FTS tests: `syncNodeFts` is not a function (export doesn't exist in search.ts yet)
  - A2 freshness tests: `isFileStale`/`getStaleFiles` not a function (exports don't exist in meta.ts yet)
  - A2 stale warnings: `parsed.freshness` is undefined (runStats/runInspect don't add freshness block yet)
  - A3 explore tests: module `./explore` not found (explore.ts doesn't exist yet) + `syncNodeFts` undefined
  - A4 affected tests: module `./affected` not found (affected.ts doesn't exist yet)
  - A5 impact tests: module `./impact` not found (impact.ts doesn't exist yet)
  - CLI parse tests: "Unknown subcommand: explore/affected/impact" (switch cases not implemented in cli.ts)
- **Integration test:** Pre-existing timeout failure (unrelated to this track)

---

## Phase 3 — Implementation (Green Phase)

Implement the minimum code needed to satisfy the tests while preserving the current Bun/ts-morph architecture.

- [ ] Task: Implement A1 — FTS-backed search
    - [ ] Add FTS creation and synchronization SQL to schema/index helpers.
    - [ ] Update scan insertion path to populate FTS state.
    - [ ] Update incremental update deletion/insertion path to keep FTS in sync.
    - [ ] Rewrite `searchNodes` to prefer FTS rank and fall back to `LIKE`.
    - [ ] Run targeted search tests and `bun test`.
    - [ ] Commit: `feat(search): Add FTS-backed node search`

- [ ] Task: Implement A2 — file metadata and freshness
    - [ ] Add `files.ts` or equivalent helper for hashing, stat capture, and freshness checks.
    - [ ] Record file metadata during full scan.
    - [ ] Refresh file metadata during incremental update.
    - [ ] Remove graph data for deleted files in update/audit pathways.
    - [ ] Add stale warnings to `stats` and `inspect` where relevant.
    - [ ] Run targeted metadata tests and `bun test`.
    - [ ] Commit: `feat(files): Track graph freshness metadata`

- [ ] Task: Implement A3 — explore command
    - [ ] Add `explore.ts` query/ranking module.
    - [ ] Add relationship expansion around best matches.
    - [ ] Add bounded source snippet extraction with stable line numbers.
    - [ ] Add text and JSON formatters.
    - [ ] Wire `explore` into CLI parsing, help, and main dispatch.
    - [ ] Run targeted explore tests and `bun test`.
    - [ ] Commit: `feat(cli): Add agent explore command`

- [ ] Task: Implement A4 — affected command
    - [ ] Add changed-file input normalization for args and stdin.
    - [ ] Add reverse traversal over imports/calls/references/renders/query/mutation/param-flow edges.
    - [ ] Add affected-file grouping and test-file classification.
    - [ ] Add shortest-path capture for JSON output.
    - [ ] Wire `affected` into CLI parsing, help, and main dispatch.
    - [ ] Run targeted affected tests and `bun test`.
    - [ ] Commit: `feat(cli): Add changed-file affected analysis`

- [ ] Task: Implement A5 — impact command
    - [ ] Reuse `resolveNode` and add exact file-path root resolution.
    - [ ] Add bidirectional traversal with edge-type and depth filters.
    - [ ] Promote route, component, hook, schema, field, and param-flow sections in output.
    - [ ] Reuse affected-test grouping for blast-radius summaries.
    - [ ] Wire `impact` into CLI parsing, help, and main dispatch.
    - [ ] Run targeted impact tests and `bun test`.
    - [ ] Commit: `feat(cli): Add symbol and file impact analysis`

- [ ] Task: Integrate Measure-oriented command guidance
    - [ ] Update README command table with `explore`, `affected`, and `impact`.
    - [ ] Add examples for Next route audit, Drizzle field impact, and changed-file test selection.
    - [ ] Update feature-request notes to mark the borrowed CodeGraph low-hanging fruit as planned.
    - [ ] Run docs-related tests if present.
    - [ ] Commit: `docs(measure): Document agent graph query workflow`

- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

---

## Phase 4 — Generate Docs, Doctor, and Closeout

Regenerate derived facts, run project health checks, and prove the track is ready for implementation closeout.

- [ ] Task: Regenerate Measure facts
    - [ ] Run `./measure/generate.sh`.
    - [ ] Inspect generated architecture and routes changes.
    - [ ] Commit generated updates if changed.

- [ ] Task: Run project quality gates
    - [ ] Run `bun test --coverage`.
    - [ ] Run `bun run lint`.
    - [ ] Run `./measure/doctor.sh`.
    - [ ] Confirm `git diff --exit-code measure/generated/`.

- [ ] Task: Rebuild and smoke test executable
    - [ ] Run `bun run build`.
    - [ ] Smoke test `./bin/build-graph help explore`.
    - [ ] Smoke test `./bin/build-graph help affected`.
    - [ ] Smoke test `./bin/build-graph help impact`.
    - [ ] Run a small fixture scan and prove `explore`, `affected`, and `impact` return bounded output.

- [ ] Task: Final track audit
    - [ ] Verify acceptance criteria in `spec.md`.
    - [ ] Record deviations in `metadata.json` if implementation scope changed.
    - [ ] Update `measure/lessons-learned.md` if the CodeGraph comparison reveals durable planning guidance.
    - [ ] Update `measure/tech-debt.md` for any intentional shortcuts.

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
