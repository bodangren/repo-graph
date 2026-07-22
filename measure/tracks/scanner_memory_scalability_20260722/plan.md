# Implementation Plan: Scanner Memory Scalability and Real-Monorepo Acceptance

Track: `scanner_memory_scalability_20260722`

Follow `measure/workflow.md` for every top-level task. Do not modify
`measure/automation-supervisor.py`.

## Phase 1: Baseline and Red Contracts

- [~] Task: Record the repeatable OOM baseline and blast radius
    - [x] Record the two kernel OOM events, exit behavior, and absent temporary database.
    - [x] Record the consumer tsconfig and tracked TS/TSX denominators.
    - [x] Trace project loading, extraction, resolution, deduplication, and persistence ownership.
    - [ ] Add stage-level timing/RSS diagnostics without changing stdout contracts.
    - [ ] Record self-graph callers/dependencies for every exported symbol changed.

- [ ] Task: Add Red scalability and semantic-equivalence tests
    - [ ] Add a deterministic many-symbol/many-call fixture that exposes superlinear lookup work.
    - [ ] Add normalized snapshot equivalence assertions for duplicate names and call resolution.
    - [ ] Add CLI diagnostics contract tests and atomic-failure assertions.
    - [ ] Capture the failing Red commands and outputs in `verification.md`.

## Phase 2: Indexed Scanner Core

- [ ] Task: Replace superlinear duplicate and symbol-resolution lookups
    - [ ] Add a deterministic duplicate counter keyed by file, node type, and base name.
    - [ ] Add a deterministic file/name symbol index populated with the primary symbol pass.
    - [ ] Route local, method, named-import, and default-import call resolution through the index.
    - [ ] Preserve established IDs, ordering, metadata, and unresolved-call behavior.

- [ ] Task: Verify the indexed implementation
    - [ ] Run focused scanner, persistence, update, and integration suites.
    - [ ] Compare normalized pre/post fixture snapshots.
    - [ ] Run TypeScript 7 and compatibility checks.
    - [ ] Measure the deterministic stress fixture and record allocation/time improvement.

## Phase 3: Bounded Full-Scan Architecture

- [ ] Task: Run the first compiled Reading Advantage acceptance probe
    - [ ] Build the candidate without installing it.
    - [ ] Scan to a new temporary database under normal concurrent workload.
    - [ ] Record stage timings, peak RSS, exit status, output artifact, and source denominator.
    - [ ] Decide from evidence whether indexed lookups satisfy FR-4.

- [ ] Task: Implement package-batched scanning if the first probe misses FR-4
    - [ ] Write Red cross-package import/call and atomic-publication tests.
    - [ ] Scan one tsconfig/package boundary at a time and release AST state between batches.
    - [ ] Preserve a lightweight global export/import index for cross-package resolution.
    - [ ] Publish only after all batches and validation succeed.

- [ ] Task: Prove real-consumer determinism and query correctness
    - [ ] Complete two scans of the same Reading Advantage revision.
    - [ ] Compare normalized semantic snapshots.
    - [ ] Verify current file coverage, stats, search, callers, inspect, freshness, FTS, and audits.
    - [ ] Record the accepted peak-RSS result against the 3.27-GiB baseline.

## Phase 4: Quality Gates, Release, and Closeout

- [ ] Task: Run complete source quality gates
    - [ ] Run TypeScript 7 and compatibility type checks.
    - [ ] Run focused and complete tests with coverage.
    - [ ] Run lint and build.
    - [ ] Run `measure/generate.sh`, generated-fact diff, and `measure/doctor.sh`.

- [ ] Task: Install and verify the canonical artifact
    - [ ] Atomically install the reviewed binary.
    - [ ] Verify source and installed checksums.
    - [ ] Repeat the consumer smoke and graph-query sequence with the installed binary.
    - [ ] Record rollback evidence.

- [ ] Task: Reconcile documentation and close the track
    - [ ] Update README, skill, limits, lessons, tech debt, metadata, and registry truth.
    - [ ] Attach commit notes and independent reviewer evidence.
    - [ ] Confirm the repo-graph and consumer worktrees contain no unexplained changes.
    - [ ] Archive only after every acceptance criterion has direct evidence.
