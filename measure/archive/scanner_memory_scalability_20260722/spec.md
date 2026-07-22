# Specification: Scanner Memory Scalability and Real-Monorepo Acceptance

Track: `scanner_memory_scalability_20260722`

## Problem

The canonical `repo-graph scan` path is correct on its self-repository and
small fixtures, but it cannot currently publish a graph for the Reading
Advantage monorepo. The kernel killed two full scans before SQLite persistence:

- 2026-07-19 at 3,230,284 KiB anonymous RSS.
- 2026-07-22 at 3,270,588 KiB anonymous RSS.

The consumer contains 42 TypeScript configuration boundaries and approximately
3,877 tracked TypeScript/TSX files. The scanner retains one complete ts-morph
`Project`, graph arrays, symbol records, repeated descendant arrays, and
deduplication copies at the same time. It also performs full-array scans for
every symbol and for repeated call resolution.

This is a release-blocking correctness issue: a scanner that cannot produce an
atomic current graph for a supported real monorepo does not satisfy its product
contract.

## Functional Requirements

### FR-1 — Measurable stage boundaries

1. Record elapsed time and peak/resident memory at project discovery, primary
   extraction, call resolution, each framework pass, deduplication, and
   persistence.
2. Diagnostics must be opt-in or written to stderr and must not alter graph
   output or machine-readable stdout.
3. Failed scans must continue to leave the previous database untouched.

### FR-2 — Linear-time symbol indexing

1. Replace per-symbol `nodes.filter` duplicate counting with a deterministic
   keyed counter.
2. Replace per-call `Array.from(symbols.values()).filter().sort()` resolution
   with a deterministic file/name index.
3. Preserve node IDs, duplicate suffixes, call targets, unresolved targets,
   ordering, and normalized persisted output on the existing fixture suite.

### FR-3 — Bounded traversal allocations

1. Avoid retaining unnecessary whole-project descendant arrays across passes.
2. Deduplicate incrementally where doing so preserves the established graph
   contract.
3. If indexed lookups alone do not meet the real-monorepo gate, scan by
   tsconfig/package boundary and release each AST project before the next one.
4. Any batched implementation must resolve cross-package imports/calls through
   a lightweight global index and publish only one atomic final database.

### FR-4 — Real-consumer acceptance

1. Run the compiled candidate against
   `/home/daniel-bo/Desktop/reading-advantage-monorepo` under normal
   concurrent development load.
2. The scan must exit 0 without kernel OOM and publish a temporary database.
3. The database must cover the current tracked TypeScript/TSX source set and
   pass stats, search, callers, inspect, freshness, integrity, and documentation
   checks appropriate to the consumer.
4. Two consecutive scans of the same revision must produce equivalent
   normalized nodes, edges, package ownership, documentation, FTS, and file
   metadata.
5. Record peak RSS and require at least a 35% reduction from the verified
   3.27-GiB failure baseline. A stricter ceiling may be adopted from Red
   evidence, but it must not be weakened to fit the implementation.

### FR-5 — Release and installation

1. TypeScript 7 and compatibility type checks, lint, build, complete tests,
   coverage, generated facts, and doctor must pass.
2. Modified production modules must retain at least 80% meaningful line
   coverage.
3. Install the reviewed binary atomically only after source and real-consumer
   acceptance.
4. Verify source/installed checksums and repeat the consumer smoke sequence
   with the installed artifact.

## Non-Functional Requirements

- Preserve graph semantics and deterministic ordering; performance is not
  allowed to trade away correctness.
- Follow Red/Green/refactor and record exact evidence in `verification.md`.
- Do not stop unrelated development servers or browser processes to manufacture
  a passing memory result.
- Do not modify the centrally managed Measure automation supervisor.

## Acceptance Criteria

- [ ] The two verified OOM failures and current consumer denominator are recorded.
- [ ] Regression tests fail before the indexed implementation and pass after it.
- [ ] Existing normalized fixture graphs are unchanged.
- [ ] The compiled candidate completes two consumer scans without OOM.
- [ ] Peak RSS is at least 35% below the 3.27-GiB failure baseline.
- [ ] Consumer graph queries and integrity checks pass against the current revision.
- [ ] Full source quality gates pass with required coverage.
- [ ] Installed and source binaries have identical checksums and behavior.

## Out of Scope

- Query-result caching, visualization, and CI comment automation.
- Weakening consumer file coverage or excluding packages merely to fit memory.
- Treating a synthetic fixture as a substitute for the real monorepo gate.
