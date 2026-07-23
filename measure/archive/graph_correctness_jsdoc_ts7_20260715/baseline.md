# Implementation baseline

Recorded 2026-07-15 before implementation. The worktree was clean at the
start of the track (`git status -sb` reported only `## master...origin/master
[ahead 1]`). The graph database existed at the project root and was less than
24 hours old.

## Reproductions

| Contract | Command | Observed result |
|---|---|---|
| Runtime suite | `CI=true bun test --no-bail` | `451 pass`, `0 fail`, `1018 expect()` calls |
| Type safety | `bun x tsc --noEmit` | Non-zero: `ExitCode` namespace misuse, unchecked parsed-argument union, `JSDocStructure` string handling, and `SourceFile` parameter mismatch |
| Build/help | `bun run build && ./bin/build-graph --help` | Exit 0; artifact `./bin/build-graph`; banner begins `build-graph — Knowledge graph builder...` |
| Graph shape | `build-graph stats ./graph.db` | 598 nodes, 655 edges, 62 files; no ordinary `calls` edges in the baseline graph |
| Caller defect | `build-graph callers ./graph.db createSchema` | No result because ordinary call edges are absent |
| Graph audit | `build-graph audit ./graph.db --json` | Baseline contains expected external `ts-morph` orphan references and cross-scope duplicate parameter groups |
| Freshness | `build-graph impact ./graph.db <file> --json` after live file mutation | Stored metadata is not consistently compared with live size/mtime/hash |
| Impact | `build-graph impact ./graph.db <file> --json` | File roots select one arbitrary contained symbol and traversal direction can be inverted |

The superseded `binary_scanner_unification_20260627` plan contains no
completed tasks and remains documentation-only; its binary, scanner, FTS, and
installation requirements are absorbed by this track.

## Baseline metadata

- Schema version: `1.0.0`.
- Source/install binary at baseline: `build-graph` (the canonical artifact did
  not yet exist).
- Test count: 451 passing across 26 files.
- Overall baseline line coverage from the track brief: 91.25%; compiled CLI
  entrypoint coverage: 14.16%.
