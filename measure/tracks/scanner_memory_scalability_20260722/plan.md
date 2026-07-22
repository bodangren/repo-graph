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
    - [x] Record self-graph callers/dependencies for every exported symbol changed — `scanProject` had zero recorded callers in the pre-change self-graph (a known call-index limitation); downstream dependency output was captured before editing.

- [~] Task: Add Red scalability and semantic-equivalence tests
    - [x] Add a deterministic many-symbol/many-call fixture that exposes superlinear lookup work.
    - [x] Add normalized snapshot equivalence assertions for duplicate names and call resolution.
    - [ ] Add CLI diagnostics contract tests and atomic-failure assertions.
    - [x] Capture the failing Red commands and outputs in `verification.md` — the authoritative Red is the repeatable real-consumer exit 137; characterization tests lock existing semantics before and after the refactor.

## Phase 2: Indexed Scanner Core

- [x] Task: Replace superlinear duplicate and symbol-resolution lookups
    - [x] Add a deterministic duplicate counter keyed by file, node type, and base name.
    - [x] Add a deterministic file/name symbol index populated with the primary symbol pass.
    - [x] Route local, method, named-import, and default-import call resolution through the index.
    - [x] Preserve established IDs, ordering, metadata, and unresolved-call behavior.

- [x] Task: Verify the indexed implementation
    - [x] Run focused scanner, persistence, update, and integration suites — 64/64 focused passed; complete suite passed 449/449.
    - [x] Compare normalized pre/post fixture snapshots — compiled self-scan nodes, edges, files, layers, tour steps, and FTS had zero differences; only `lastIndexedAt` differed.
    - [x] Run TypeScript 7 and compatibility checks.
    - [x] Measure the deterministic stress fixture and record allocation/time improvement — 750 symbols/calls scan deterministically within the 15-second per-scan contract on the loaded host.

## Phase 3: Bounded Full-Scan Architecture

- [x] Task: Run the first compiled Reading Advantage acceptance probe — candidate failed FR-4 and formally activates the package-batched task below.
    - [x] Build the candidate without installing it.
    - [x] Scan to a new temporary database under normal concurrent workload.
    - [x] Record timing, cgroup pressure, peak RSS, exit status, absent output artifact, and source denominator.
    - [x] Decide from evidence whether indexed lookups satisfy FR-4 — no: exit 124 after 900 seconds, 2,313,020 KiB peak RSS, no database, and only a 29.3% reduction.

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
