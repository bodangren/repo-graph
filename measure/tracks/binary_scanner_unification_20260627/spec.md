# Specification: Binary & Scanner Unification (2026-06-27)

## Overview

Two long-standing tech-debt items in `repo-graph/measure/tech-debt.md` trace back
to the original `graphdb_20260524` track (which built on a wrong product spec):

1. **Binary-naming gap.** `package.json` declares `name: "repo-graph"`, but
   `bun run build` compiles to `./bin/build-graph` (compile target name in the
   build script). The hook scripts installed by `install-hooks` invoke
   `repo-graph` per spec, so users have to install the binary twice (under
   both names) — see `git_hook_incremental_updates_20260528` Phase 4 closeout.
   The compiled binary's help banner still reads "build-graph — Knowledge
   graph builder…" — a cosmetic mismatch.
2. **Wrong scanner.** `build-graph-db.ts` reads JSON input instead of scanning
   TypeScript source files. The entire `graphdb_20260524` track built on this
   wrong spec. The agent_explore_freshness_impact_20260622 track later added
   the schema-level helpers (`syncNodeFts`, `recordFileMetadata`) and
   `ingest.ts` was designed for JSON batch insert, but neither was wired to
   ts-morph.

Both items are tracked as **Severity High / Medium, Status Open since
2026-05-24** and have been "future track" items for 4+ weeks. This track
resolves both in one cohesive change because they share the same compile
artifact and the same upstream spec (AST extraction from `.ts`/`.tsx`).

## Why now

- The `git_hook_incremental_updates_20260528` track is shipped; the
  install-hooks workaround is fragile and confusing for new users.
- The `agent_explore_freshness_impact_20260622` track produced schema-level
  helpers but left the scan-time wiring as a Phase 3 §A1/§A2 deferral.
- Repos that onboard `repo-graph` as a build-graph dependency (e.g., the
  reading-advantage-monorepo and measure projects) are blocked from clean
  single-binary install until the rename lands.

## Functional Requirements

- **FR-1:** Rename `graphing-tools/build-graph.ts` to `repo-graph.ts` and
  update the build script in `package.json` to compile to `./bin/repo-graph`.
  Update the `bin` field to point to the new path.
- **FR-2:** Update the compiled binary's help banner to read
  "repo-graph — Knowledge graph builder for TypeScript codebases" (was
  "build-graph — Knowledge graph builder…").
- **FR-3:** Update all references in `scripts/`, `tests/`, `.githooks/`,
  `README.md`, and `AGENTS.md` that call `build-graph` to call `repo-graph`
  instead.
- **FR-4:** Update the install-hooks flow so that `~/.local/bin/repo-graph`
  is the single install target (no more dual-name workaround).
- **FR-5:** Rewrite `src/build-graph-db.ts` to scan TypeScript source files
  via `ts-morph` and extract nodes (file, function, class, interface,
  type_alias, schema, field) + edges (contains, imports, extends,
  implements, calls, depends_on, has_field, references, renders, uses_hook,
  queries, mutates) — matching the schema documented in `AGENTS.md`.
- **FR-6:** Wire `syncNodeFts(node)` and `recordFileMetadata(path, stat,
  nodeCount)` into the new scan path so FTS results stay current and
  freshness warnings fire correctly after a full scan.
- **FR-7:** Add an integration test (`tests/integration/ast-scan.test.ts`)
  that scans a real fixture repo and asserts the expected node/edge counts
  and the FTS-matches-stay-current invariant. The test reuses the
  `__tests__/helpers/testDb.ts`-style harness pattern from the
  `review_findings_followup_20260626` track in the reading-advantage-monorepo.
- **FR-8:** Update `measure/tech-debt.md` rows for the binary-naming gap
  (graphdb_20260524 row 1) and the JSON-scanner rewrite (graphdb_20260524
  row 2) from Open → Resolved with SHA evidence pointing at the closeout
  commit.

## Non-Functional Requirements

- TDD per FR where applicable (FR-5/FR-6/FR-7 each have a Red proof first).
- No regression in the existing agent_explore_freshness_impact_20260622
  tests; the new scan path must produce identical-or-richer graph output for
  the same input fixture.
- `bun run build` exit code must remain 0 throughout.
- The renamed binary must be a single file at `./bin/repo-graph` (no
  symlinks, no dual-install).

## Acceptance Criteria

1. `./bin/repo-graph --help` prints the new banner
   ("repo-graph — Knowledge graph builder for TypeScript codebases").
2. `bun run build` produces `./bin/repo-graph` (no `./bin/build-graph`).
3. `~/.local/bin/repo-graph` is the only install target documented in
   `.githooks/install.sh`; the dual-name workaround is removed.
4. Scanning a real fixture repo via the rewritten scan path produces the
   expected node + edge counts (per the existing fixture in
   `__tests__/fixtures/`).
5. `syncNodeFts` and `recordFileMetadata` are called from the scan path;
   post-scan FTS search returns the expected node names.
6. `measure/tech-debt.md` rows for the binary-naming gap and JSON-scanner
   rewrite are marked Resolved with SHA evidence.
7. The existing agent_explore_freshness_impact_20260622 test suite remains
   green (no regression).

## Out of Scope

- Reworking the schema. The agent_explore_freshness_impact_20260622 schema
  is correct; this track uses it as-is.
- New node/edge types. The set documented in `AGENTS.md` is the contract.
- Performance optimization beyond "scan completes in <60s on the fixture
  repo." The `query_performance_benchmarks_20260528` track owns real perf.
- Migrating users off the dual-name workaround. Users with the workaround
  installed can `rm ~/.local/bin/build-graph` themselves; this track does
  not auto-clean.