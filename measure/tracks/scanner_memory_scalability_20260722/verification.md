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

Pending implementation.

## Real-Consumer Acceptance

Pending implementation.

## Quality Gates and Release

Pending implementation.
