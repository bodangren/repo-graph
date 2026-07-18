# Project Tracks

This file tracks all major tracks for the project.

## Archived Tracks

- [x] **Track: Build graph.db builder with Bun and native SQLite** *(based on incorrect product spec — built JSON-to-SQLite converter instead of TS scanner)*
  *Link: [./archive/graphdb_20260524/](./archive/graphdb_20260524/)*

- [x] **Track: Build the `build-graph` CLI tool — ts-morph scanner → SQLite knowledge graph**
  *Link: [./archive/buildgraph_20260524/](./archive/buildgraph_20260524/)*

- [x] **Track: Convenience query commands — deps, callers, path, stats, files + relative paths**
  *Link: [./archive/convenience_20260524/](./archive/convenience_20260524/)*

---

- [x] **Track: Remediate code-review findings — convenience query commands (9 bugs)**
  *Link: [./archive/bugfix_20260525/](./archive/bugfix_20260525/)*

---

- [x] **Track: LLM UX improvements — --json, exit code taxonomy, inspect, --limit, --depth**
  *Link: [./archive/llmux_20260525/](./archive/llmux_20260525/)*

---

- [x] **Track: Scanner enrichment — runtime schema extraction & framework-aware edges** *(superseded by scannerfix_20260525 and migration_audit_20260525)*
  *Link: [./archive/scanner_20260525/](./archive/scanner_20260525/)*

---

- [x] **Track: Scanner data-quality fixes — resolve dangling edges, defineTable extraction, queries/mutates, cross-package imports, inspect unresolved**
  *Link: [./archive/scannerfix_20260525/](./archive/scannerfix_20260525/)*

---

- [x] **Track: Migration-audit features — string-literal tracking, param-flow taint edges, route discovery**
  *Link: [./archive/migration_audit_20260525/](./archive/migration_audit_20260525/)*

---

---

- [x] **Track: Graph Integrity Audit Command — detect stale nodes, missing files, orphan edges, and duplicate nodes via `build-graph audit`**
  *Link: [./archive/audit_20260529/](./archive/audit_20260529/)*

---

- [x] **Track: Scanner Extensibility — Config-Driven Edge Types, Route Mode Tags, and Custom File Patterns**
  *Link: [./archive/extensibility_20260603/](./archive/extensibility_20260603/)* — Add custom edge types via `build-graph.config.json`, extract `export const mode = '...'` from route files as node tags, and support `--include` globs for non-TS files.

- [x] **Track: Agent Explore, Freshness, and Changed-File Impact**
  *Link: [./archive/agent_explore_freshness_impact_20260622/](./archive/agent_explore_freshness_impact_20260622/)* — Add FTS-backed search, file freshness metadata, a Measure-friendly `explore` command, and changed-file `affected`/`impact` analysis inspired by CodeGraph's low-hanging product patterns.

---

- [x] **Track: Git Hook Integration for Incremental Graph Updates**
  *Link: [./archive/git_hook_incremental_updates_20260528/](./archive/git_hook_incremental_updates_20260528/)* — Wire `repo-graph update` into git pre-commit and post-checkout hooks so the graph.db stays automatically synchronized with code changes.

## Superseded Tracks

- [x] **Track: Binary & Scanner Unification** — *superseded before implementation on 2026-07-15*
  *Link: [./tracks/binary_scanner_unification_20260627/](./tracks/binary_scanner_unification_20260627/)*
  *Superseded by: [graph_correctness_jsdoc_ts7_20260715](./tracks/graph_correctness_jsdoc_ts7_20260715/). All 8 planned tasks were unstarted and are absorbed into the comprehensive correctness release.*

## Upcoming Tracks

_Status (verified 2026-07-15): the critical correctness track below is complete. The three product tracks are now unblocked for separate planning and implementation._

- [x] **Track: Foundational Graph Correctness, JSDoc Audit, TypeScript 7, and Release Hardening** — *completed 2026-07-15*
  *Link: [./tracks/graph_correctness_jsdoc_ts7_20260715/](./tracks/graph_correctness_jsdoc_ts7_20260715/)*
  *Status: complete → 12 FRs, 37/37 top-level tasks | Priority: CRITICAL | Implementation: `9a1a602` | Supersedes: `binary_scanner_unification_20260627`*
  *Scope: deterministic full/incremental scans, ordinary call edges, sound impact/affected traversal, live freshness/FTS, accurate integrity audit, structured JSDoc + `audit --docs`, comprehensive compiled-path tests, TS7/TS6 type gates, canonical help/skill, and verified executable/skill installation.*

- [ ] **Track: Query Performance Optimization & Benchmarks**
  *Link: [./tracks/query_performance_benchmarks_20260528/](./tracks/query_performance_benchmarks_20260528/)* — Add composite SQLite indexes, query result caching, and a benchmark suite targeting sub-100ms dependency lookups on monorepos.
  *Unblocked after: `graph_correctness_jsdoc_ts7_20260715` completion and verification.*

- [ ] **Track: Graph Visualization Export (DOT & HTML)**
  *Link: [./tracks/graph_visualization_export_20260528/](./tracks/graph_visualization_export_20260528/)* — Export the knowledge graph to Graphviz DOT format and an interactive HTML page with D3.js or Cytoscape.js.
  *Unblocked after: `graph_correctness_jsdoc_ts7_20260715` completion; visualization must consume its direction-preserving relationships.*

- [ ] **Track: CI/CD Integration — GitHub Action**
  *Link: [./tracks/ci_cd_integration_20260528/](./tracks/ci_cd_integration_20260528/)* — Create a GitHub Action that runs `repo-graph scan` on PRs, generates a dependency impact report, and comments the report on the PR.
  *Unblocked after: `graph_correctness_jsdoc_ts7_20260715` completion and its idempotent scan/update, traversal, type-check, and artifact gates.*

- [ ] **Track: Git Diff Mode — Changed Nodes/Edges and Blast Radius**
  *Link: [./tracks/git_diff_mode_20260716/](./tracks/git_diff_mode_20260716/)* — Add `repo-graph diff <db> <git-ref>`: classify added/removed/modified files against git history, report per-node and per-edge deltas, and compute blast radius via impact traversal with a staleness guard. Implements feature request #6.
  *Unblocked after: `graph_correctness_jsdoc_ts7_20260715` completion (sound `affected`/`impact` traversal and incremental update comparison).*
