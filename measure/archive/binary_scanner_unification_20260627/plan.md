# Implementation Plan: Binary & Scanner Unification

Track: `binary_scanner_unification_20260627`
Spec: see `spec.md`. TDD per FR where applicable; atomic commit per task.

## Phase 1: Rename binary + update build script (FR-1, FR-2, FR-3)

- [ ] **1.1** `git mv graphing-tools/build-graph.ts graphing-tools/repo-graph.ts`.
- [ ] **1.2** Update `package.json`:
  - `name` field stays `"repo-graph"` (already correct).
  - `bin` field: `./bin/build-graph` → `./bin/repo-graph`.
  - `scripts.build` (or equivalent compile target name): `build-graph`
    → `repo-graph`.
- [ ] **1.3** Update binary banner in `repo-graph.ts`: "build-graph" →
  "repo-graph".
- [ ] **1.4** `rg -l "\bbuild-graph\b" scripts tests .githooks README.md
  AGENTS.md` — list every reference; update each.
- [ ] **1.5** Run `bun run build`; confirm `./bin/repo-graph` exists, no
  `./bin/build-graph`.
- [ ] **1.6** Run `./bin/repo-graph --help`; confirm banner.

## Phase 2: Update install-hooks to single install (FR-4)

- [ ] **2.1** Edit `.githooks/install.sh` (or equivalent hook installer) to
  install only `~/.local/bin/repo-graph`; remove the dual-name workaround
  copy line.
- [ ] **2.2** Run install on a throwaway prefix to verify; commit.

## Phase 3: Rewrite scanner to ts-morph AST extraction (FR-5, FR-6, FR-7)

- [ ] **3.1** Red test — `tests/integration/ast-scan.test.ts`:
  - Scan the fixture repo in `__tests__/fixtures/`.
  - Assert node count, edge count, and a specific node+edge by name.
  - Assert `syncNodeFts` was called for every scanned node (via spy).
  - **Confirmed RED on current code** (scanner reads JSON, ignores fixture).
- [ ] **3.2** Rewrite `src/build-graph-db.ts` to use ts-morph: open each
  `.ts`/`.tsx` file, walk the AST, emit nodes (file, function, class,
  interface, type_alias, schema, field) + edges (contains, imports,
  extends, implements, calls, depends_on, has_field, references, renders,
  uses_hook, queries, mutates) — matching the schema in `AGENTS.md`.
- [ ] **3.3** Wire `syncNodeFts(node)` and `recordFileMetadata(path, stat,
  nodeCount)` calls into the new scan path so FTS stays current and
  freshness warnings fire correctly.
- [ ] **3.4** Re-run integration test — **GREEN**.

## Phase 4: Regression check (NFR — no regression in agent_explore test suite)

- [ ] **4.1** Run the agent_explore_freshness_impact_20260622 test suite;
  confirm all green.
- [ ] **4.2** Run the existing build-graph unit tests (excluding the
  rewritten integration test); confirm all green.

## Phase 5: Tech-debt closeout (FR-8)

- [ ] **5.1** Update `measure/tech-debt.md` row for binary-naming gap
  (graphdb_20260524 row 1) → Resolved with SHA evidence.
- [ ] **5.2** Update `measure/tech-debt.md` row for JSON-scanner rewrite
  (graphdb_20260524 row 2) → Resolved with SHA evidence.
- [ ] **5.3** Update `metadata.json` (status → done, actual_tasks).
- [ ] **5.4** Update `measure/tracks.md` with archive path; archive track.

## Acceptance Criteria Summary

| AC | Description | FR | Status |
| --- | --- | --- | --- |
| AC-1 | `--help` prints new banner | FR-2 | [ ] |
| AC-2 | `bun run build` produces `./bin/repo-graph` only | FR-1 | [ ] |
| AC-3 | install-hooks installs single binary | FR-3, FR-4 | [ ] |
| AC-4 | Integration test scans real fixture and asserts counts | FR-5, FR-7 | [ ] |
| AC-5 | FTS stays current post-scan | FR-6 | [ ] |
| AC-6 | tech-debt rows → Resolved with SHA evidence | FR-8 | [ ] |
| AC-7 | No regression in agent_explore test suite | NFR | [ ] |

## Deviations

(none yet — fill in at closeout. Likely deviation: schema-level helpers
expected ts-morph-driven ingest but the existing `ingest.ts` is JSON-shaped;
may need an ingest.ts refactor too. Document in deviations if so.)

## Dependencies

- `agent_explore_freshness_impact_20260622` schema-level helpers
  (`syncNodeFts`, `recordFileMetadata`) must remain stable through Phase 3.
  If a refactor of those helpers is needed for the new scan path, document
  in deviations and split into a follow-up track.
- `query_performance_benchmarks_20260528` may want to use the new scan
  path's output; coordinate if that track is in flight.