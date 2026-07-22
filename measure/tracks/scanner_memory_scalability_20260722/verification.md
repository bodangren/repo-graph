# Verification: Scanner Memory Scalability and Real-Monorepo Acceptance

Track: `scanner_memory_scalability_20260722`

## Verified Red Baseline

- 2026-07-19: the kernel killed `repo-graph` at 3,230,284 KiB anonymous RSS.
- 2026-07-22: the kernel killed `repo-graph` at 3,270,588 KiB anonymous RSS.
- The 2026-07-22 command exited 137 before its 900-second timeout.
- No candidate database or atomic temporary database remained after failure.
- The consumer has 42 discovered tsconfig boundaries and approximately 3,877
  tracked TypeScript/TSX files.
- The output database is opened only after `createProject` and
  `scanProject` have retained the complete AST project and graph snapshot.

## Source Hotspots

- `graphing-tools/repo-graph.ts`: one Project loads all discovered tsconfigs.
- `graphing-tools/scanner-core.ts`: per-symbol full `nodes.filter` duplicate
  counting and per-call full symbol-map materialization/filter/sort.
- Scanner core plus five framework passes repeatedly traverse complete source
  files before final map-based deduplication copies the graph.

## Red/Green Evidence

### Blast radius before editing

- Exact exported node:
  `function:/home/daniel-bo/Desktop/repo-graph/graphing-tools/scanner-core.ts:scanProject`.
- `repo-graph callers ... --json` returned no recorded callers, which is
  inconsistent with the source imports and remains a known self-graph
  limitation rather than evidence of zero use.
- Downstream graph output recorded `addCallEdges`, `addSymbol`,
  `deduplicateAndSort`, the five framework passes, and persistence-related
  consumers.

### Characterization and indexed Green

- Pre-change characterization run initially exposed an invalid overload fixture;
  after correcting it to declarations that ts-morph actually enumerates, 4/4
  behavior cases passed against the old implementation.
- The indexed implementation replaces per-symbol full-node scans with a
  composite family counter and per-call full-map allocations/sorts with
  file/name buckets sorted once.
- Coverage now includes duplicate naming, local tie-breaking, aliased and
  unaliased named imports, anonymous default imports, `this`- and
  class-qualified methods, unresolved identity/metadata, and a 750-symbol/
  750-call deterministic fixture.
- Final expanded focused characterization: 8 passed, 0 failed, 17 assertions.
- Focused scanner/persistence/integration/monorepo gate before the expanded
  cases: 64 passed, 0 failed, 149 assertions.
- TypeScript 7 and TypeScript 6 compatibility checks exited 0.
- Complete source test suite: 449 passed, 0 failed, 1,063 assertions across
  27 files in 101.23 seconds.
- Lint and compiled build exited 0, although independent review found the
  existing ESLint configuration does not actually select TypeScript files;
  that gate defect remains open and cannot be counted as substantive lint
  coverage.

### Compiled semantic equivalence

- Baseline binary: `/tmp/repo-graph-index-baseline`.
- Candidate binary: `/tmp/repo-graph-index-candidate`.
- Both scanned the same post-change repo-graph source:
  2,273 nodes and 2,781 edges.
- Normalized symmetric differences:
  - nodes: 0
  - edges excluding auto-increment ID: 0
  - files excluding `indexed_at`: 0
  - layers: 0
  - tour steps: 0
  - FTS content: 0
  - metadata: only the expected `graph.lastIndexedAt` value differed.
- Loaded-host self-scan measurements:
  - baseline: 21.73 seconds, 573,208 KiB peak RSS.
  - candidate: 21.45 seconds, 592,228 KiB peak RSS.
- The small self-repo is semantic proof, not evidence for the consumer memory
  gate.

## Real-Consumer Acceptance

### First indexed candidate probe — rejected

Command:

```bash
systemd-run --user --scope --quiet \
  -p MemoryHigh=2200M \
  -p MemoryMax=2600M \
  -p MemorySwapMax=256M \
  /usr/bin/time -v timeout 900 \
  /tmp/repo-graph-index-candidate scan \
  /home/daniel-bo/Desktop/reading-advantage-monorepo \
  /tmp/reading-advantage-index-candidate-99405e0.db
```

Result:

- Exit: 124 after 15:00.74.
- Peak RSS: 2,313,020 KiB.
- Cgroup peak while observed: 2,340,532,224 bytes.
- Cgroup `oom=0` and `oom_kill=0`; the safety boundary worked.
- Swap stayed at its 256-MiB ceiling and sustained memory pressure caused
  heavy reclaim.
- No destination or atomic temporary database was created, so atomicity held.
- Reduction from the 3,270,588-KiB failure baseline was approximately 29.3%,
  below the required 35% gate (2,125,882 KiB ceiling).

Decision: indexed lookups are retained as a behavior-preserving improvement,
but they do not satisfy FR-4. Package/tsconfig-batched scanning with AST release
between batches is mandatory before another consumer acceptance claim.

## Quality Gates and Release

Release remains pending. The indexed slice is not installed because the
real-consumer gate failed.

## Bounded Architecture Green

- Commit: `70c084d`.
- The planner assigns each source to its deepest TypeScript configuration and
  splits ownership into deterministic batches of at most 32 files.
- Only one syntax-only in-memory ts-morph Project is active at a time. Each
  Project is released before the next batch.
- AST-free symbol, import-binding, and deferred-call records resolve calls
  globally after all batches. Module resolution is cached per tsconfig and
  fails closed for files outside the planned source denominator.
- Persistence writes a temporary database from exact source paths and promotes
  it only after the complete snapshot validates.
- Stderr diagnostics now cover project discovery, primary extraction, schema,
  framework, string-literal, parameter-flow, and route passes, call resolution,
  deduplication, and persistence. The CLI contract test proves stdout remains
  unchanged.

## Real-Consumer Acceptance — H, I, and release candidate J

All candidates used the same Reading Advantage source denominator:

- 43 TypeScript configurations.
- 128 batches.
- 3,285 uniquely owned TypeScript/TSX files.
- Maximum active Projects: 1.

Candidate H:

- Exit 0 in 3:42.69.
- Peak RSS 1,726,980 KiB.
- 85,860 nodes, 113,651 edges, 3,285 files.
- Zero missing edge sources, missing edge targets, and file errors.

Candidate I produced the same complete database and final scan log. Its outer
systemd wrapper received SIGTERM after completion, so no clean wrapper-exit or
RSS claim is made. Normalized H/I symmetric differences were zero for nodes,
edges excluding generated IDs, files excluding indexed timestamps, layers,
tour steps, FTS, and metadata excluding `lastIndexedAt`.

Release candidate J bound acceptance to the exact final source:

- Exit 0 in 6:05.40 under `MemoryHigh=2200M`, `MemoryMax=2600M`, and
  `MemorySwapMax=256M`.
- Peak RSS 1,613,340 KiB: 50.7% below the 3,270,588-KiB failure baseline and
  below the required 2,125,882-KiB ceiling.
- 85,860 nodes, 113,651 edges, 3,285 files.
- Zero missing edge sources, missing edge targets, and file errors.
- Zero normalized node, edge, and file differences from H.
- Stats and freshness reported 85,860 nodes, 113,651 edges, 3,285 files, with
  no stale or missing files.
- FTS search, exact-ID callers, and exact-ID inspect for
  `createTenantDB` exited 0. Name-only search remains correctly ambiguous
  because unresolved call placeholders share the display name.

## Audit Acceptance

The original audit path created a dependency-resolving Project per file and
timed out at both 600 and 900 seconds. The bounded syntax-only implementation:

- passes 28/28 audit tests;
- completes the consumer audit in 1:35 at 1,313,132 KiB peak RSS;
- reports zero missing files, stale symbols, orphan edges, and duplicate nodes.

The audit exits 1 because 3,944 field/route nodes are explicitly
`unauditedSymbols`. This is an accepted disclosure, not a hidden pass: current
stale detection intentionally requires a full scanner rerun for those derived
node forms, and candidate J is that current full rerun. The installed binary
repeated the audit in 1:06 at 1,288,076 KiB with the same structural-zero /
derived-disclosure contract.

## Quality, Coverage, and Installation

- Focused final gate: 43 passed, 0 failed, 148 assertions.
- Complete suite: 462 passed, 0 failed, 1,124 assertions across 29 files.
- Complete coverage: 97.63% functions and 95.39% lines.
- Modified production line coverage:
  - `scanner-core.ts`: 99.70%
  - `batched-scan.ts`: 98.01%
  - `persistence.ts`: 97.16%
  - `audit.ts`: 95.54%
  - `repo-graph.ts`: 86.96%
- TypeScript 7, TypeScript 6 compatibility, configured lint, compiled build,
  generated facts, and Measure doctor exited 0.
- Implementation commit `70c084d` has an auditable Git note.
- Source and installed binary SHA-256:
  `e100ba33d629163d492e950214b330fb40c2fe87fbfcc2ade64cff3ae9aa7a71`.
- Rollback binary:
  `/tmp/repo-graph-installed-pre-scanner-memory-20260722`, SHA-256
  `30cfb1adce91b69351d90a61dda1034f4ca8c7c94358e3798fed42fc5477adcf`.
- Installed stats, FTS search, exact-ID callers/inspect/freshness, consumer
  audit, and atomic monorepo-fixture scan all exercised the installed artifact.

Decision: **PASS.** The scanner memory track is release-ready and may archive.
