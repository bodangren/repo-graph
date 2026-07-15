# Verification: graph_correctness_jsdoc_ts7_20260715

Verified 2026-07-15 from `/home/daniel-bo/Desktop/repo-graph`.

## Quality gates

- `bun run typecheck` — pass with TypeScript 7.0.2.
- `bun run typecheck:compat` — pass with `tsc6` from `@typescript/typescript6` 6.0.2.
- `bun run lint` — pass.
- `bun run build` — pass; compiled artifact: `bin/repo-graph`.
- `bun run generate` — pass.
- `bun run doctor` — pass, including ESLint boundaries and generated-doc freshness.
- `CI=true bun test --coverage` — 441 pass, 0 fail, 1,046 assertions across 26 files; 95.18% line coverage and 97.48% function coverage overall. Every modified production module meets the 80% line gate; the lowest is `impact.ts` at 88.25%.

## Graph correctness

- Installed `/home/daniel-bo/.local/bin/repo-graph scan . ./graph.db` — 2,229 nodes, 2,729 edges, 56 files.
- Two consecutive installed compiled scans produced the same normalized snapshot SHA-256: `559e27a35e95acea7192681db1a9fb2a7e4f9c0892b60578368ce130c2d3f809`. The normalization excludes only volatile indexing timestamps.
- `callers ./graph.db createSchema --json` returns five persisted callers: `handleInit`, `persistGraph`, `persistSnapshotAtomically`, `runUpdate`, and `scanAndPersistAtomically`.
- `audit ./graph.db --docs --json` returns empty `missingFiles`, `staleSymbols`, `orphanEdges`, `duplicateNodes`, `unauditedSymbols`, and `documentationIssues` arrays.
- Installed incremental smoke test passed after a documentation-only edit: one file reconciled, structured JSDoc/summary changed, FTS search found the new text, and the documentation audit stayed clean.

## Artifact and documentation installation

- Source and installed executable SHA-256: `30cfb1adce91b69351d90a61dda1034f4ca8c7c94358e3798fed42fc5477adcf`.
- Tracked and installed `build-graph` skill SHA-256: `c40c07e79fbcc52d4dd5b976a3bc2d90423e5e75f1a6e36e3e0bb3f20ab72972`.
- Installed executable reports version `0.1.0` and canonical `repo-graph` help.
- Obsolete `/home/daniel-bo/.local/bin/build-graph` executable removed after smoke verification; the requested skill directory/name remains `build-graph`.

## Deliberate deviations

- `update` uses the same deterministic full-scan persistence contract for the final state, with atomic promotion for on-disk databases; this makes full and incremental normalized snapshots equivalent while preserving the update result contract.
- Dead legacy JSON scanner/ingest workers and their obsolete tests were removed after the canonical AST path was established.
- Documentation auditing caches one ts-morph project/source-file pair per path to keep the self-audit practical.
