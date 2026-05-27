# Spec: Query Performance Optimization & Benchmarks

## Overview

The `repo-graph` query commands (`deps`, `callers`, `path`, `stats`) currently run against a simple SQLite schema with single-column indexes. On large codebases (10k+ files, 100k+ nodes), multi-hop dependency lookups can take seconds. This track adds composite indexes, implements query-result caching, and establishes a benchmark suite with a target of sub-100ms for common dependency lookups on monorepo-scale graphs.

---

## Functional Requirements

### Q1 — Composite SQLite Indexes

Add composite indexes that accelerate the most common multi-hop query patterns.

**Index definitions:**

| Index | Columns | Accelerates |
|-------|---------|-------------|
| `idx_edges_source_type` | `source, edge_type` | `deps` and `callers` filtered by type |
| `idx_edges_target_type` | `target, edge_type` | Reverse lookups with type filter |
| `idx_nodes_type_package` | `node_type, package_id` | `stats` breakdowns and package-filtered queries |
| `idx_nodes_file_path` | `file_path, node_type` | File-scoped incremental updates |
| `idx_edges_source_target` | `source, target` | Path-finding queries |

**Migration:** Indexes are created on fresh databases via `schema.ts`. For existing databases, the benchmark suite must report whether indexes are present and warn if missing.

### Q2 — Query Result Caching

Implement an in-memory LRU cache for repeated identical queries within a single CLI invocation.

**Behavior:**
- Cache key: SHA-256 of the normalized SQL query string + bound parameters.
- Cache size: 100 entries (configurable via `--cache-size`).
- Scope: per-process only; no persistent disk cache.
- Invalidation: cache is discarded when the CLI exits.

### Q3 — Benchmark Suite

Create a `benchmark/` directory with scripts that measure scan and query performance.

**Benchmarks:**

| Benchmark | Input | Metric |
|-----------|-------|--------|
| `bench_scan_large` | Synthetic monorepo (10k `.ts` files) | Total scan time |
| `bench_deps_lookup` | 100 random `deps` queries | P50 / P95 / P99 latency |
| `bench_callers_lookup` | 100 random `callers` queries | P50 / P95 / P99 latency |
| `bench_path_finding` | 20 random source→target pairs | P50 / P95 / P99 latency |
| `bench_stats` | `stats` command on full graph | Latency |

**Target thresholds:**
- `deps` and `callers`: p95 < 100ms
- `path`: p95 < 500ms
- `stats`: < 50ms
- `scan`: < 60s for 10k files

**Output:** JSON report written to `benchmark/results/<timestamp>.json`.

### Q4 — Performance Regression CI Gate

Add a `repo-graph benchmark` command that runs the suite and exits with code 1 if any metric exceeds its threshold.

---

## Non-Functional Requirements

- Indexes must not increase database size by more than 30%.
- Cache must not increase peak memory usage by more than 50MB.
- Benchmarks must be deterministic (same random seed for synthetic project generation).
- All existing tests pass without modification.
- New benchmark code does not need unit-test coverage (it is tested by running).

---

## Acceptance Criteria

- [ ] `bun benchmark` runs all five benchmarks and produces a JSON report.
- [ ] `deps` p95 latency on the 10k-file synthetic monorepo is < 100ms.
- [ ] `callers` p95 latency on the 10k-file synthetic monorepo is < 100ms.
- [ ] Running the same query twice in one CLI invocation hits the cache (verified via debug log).
- [ ] `repo-graph benchmark` exits with code 1 when a threshold is exceeded.
- [ ] Existing 172 tests continue to pass.

---

## Out of Scope

- Persistent query cache across CLI invocations (requires cache-invalidation strategy).
- Parallel scan across worker threads (investigated later if scan target is missed).
- Database-level query planner hints or VIRTUAL TABLE usage.
- Real-world monorepo benchmarking (synthetic data is sufficient for this track).
