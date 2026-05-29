# Project Tracks

This file tracks all major tracks for the project.

---

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

- [ ] **Track: Scanner enrichment — runtime schema extraction & framework-aware edges** *(superseded by scannerfix_20260525 and migration_audit_20260525)*
  *Link: [./tracks/scanner_20260525/](./tracks/scanner_20260525/)*

---

- [x] **Track: Scanner data-quality fixes — resolve dangling edges, defineTable extraction, queries/mutates, cross-package imports, inspect unresolved**
  *Link: [./archive/scannerfix_20260525/](./archive/scannerfix_20260525/)*

---

- [x] **Track: Migration-audit features — string-literal tracking, param-flow taint edges, route discovery**
  *Link: [./archive/migration_audit_20260525/](./archive/migration_audit_20260525/)*

---

---

- [~] **Track: Graph Integrity Audit Command — detect stale nodes, missing files, orphan edges, and duplicate nodes via `build-graph audit`**
  *Link: [./tracks/audit_20260529/](./tracks/audit_20260529/)*

## Upcoming Tracks

- [ ] **Track: Git Hook Integration for Incremental Graph Updates**
  *Link: [./tracks/git_hook_incremental_updates_20260528/](./tracks/git_hook_incremental_updates_20260528/)* — Wire `repo-graph update` into git pre-commit and post-checkout hooks so the graph.db stays automatically synchronized with code changes.

- [ ] **Track: Query Performance Optimization & Benchmarks**
  *Link: [./tracks/query_performance_benchmarks_20260528/](./tracks/query_performance_benchmarks_20260528/)* — Add composite SQLite indexes, query result caching, and a benchmark suite targeting sub-100ms dependency lookups on monorepos.

- [ ] **Track: Graph Visualization Export (DOT & HTML)**
  *Link: [./tracks/graph_visualization_export_20260528/](./tracks/graph_visualization_export_20260528/)* — Export the knowledge graph to Graphviz DOT format and an interactive HTML page with D3.js or Cytoscape.js.

- [ ] **Track: CI/CD Integration — GitHub Action**
  *Link: [./tracks/ci_cd_integration_20260528/](./tracks/ci_cd_integration_20260528/)* — Create a GitHub Action that runs `repo-graph scan` on PRs, generates a dependency impact report, and comments the report on the PR.
