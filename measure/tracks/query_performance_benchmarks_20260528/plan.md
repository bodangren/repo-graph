# Implementation Plan: Query Performance Optimization & Benchmarks

Features are implemented in dependency order: indexes first, then caching, then benchmarks. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Schema & Contract

Update `schema.ts` to include composite indexes before writing any tests or implementation.

- [ ] Task: Add composite index definitions to schema
    - [ ] Add `idx_edges_source_type` on `edges(source, edge_type)`
    - [ ] Add `idx_edges_target_type` on `edges(target, edge_type)`
    - [ ] Add `idx_nodes_type_package` on `nodes(node_type, package_id)`
    - [ ] Add `idx_nodes_file_path` on `nodes(file_path, node_type)`
    - [ ] Add `idx_edges_source_target` on `edges(source, target)`
    - [ ] Add `createIndexes()` helper and call it in `initDatabase()`

- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Tests (Red Phase)

Write all failing tests before touching caching or benchmark implementation.

- [ ] Task: Tests Q2 — Query result caching (`cache.test.ts`)
    - [ ] Add: Cache stores and returns result for identical query + params
    - [ ] Add: Cache misses for different queries
    - [ ] Add: Cache evicts oldest entry when capacity is exceeded
    - [ ] Add: Cache is empty on fresh CLI invocation
    - [ ] Add: `--cache-size` CLI option changes cache capacity

- [ ] Task: Tests Q4 — Benchmark command parsing (`benchmark.test.ts`)
    - [ ] Add: `repo-graph benchmark` runs all benchmarks and exits 0 when passing
    - [ ] Add: `repo-graph benchmark` exits 1 when a threshold is exceeded
    - [ ] Add: `repo-graph benchmark --output results.json` writes JSON report to file

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

- [ ] Task: Implement Q1 — Composite SQLite indexes
    - [ ] Add index creation SQL to `schema.ts`
    - [ ] Ensure indexes are created on fresh DB initialization
    - [ ] Add `--check-indexes` diagnostic to `repo-graph doctor` (or similar)
    - [ ] Run `bun test`; confirm existing queries still pass
    - [ ] Commit: `perf(schema): Add composite indexes for common query patterns`

- [ ] Task: Implement Q2 — Query result caching
    - [ ] Create `queryCache.ts` with `LruCache` class
    - [ ] Integrate cache into `runQuery` / `runDeps` / `runCallers` / `runPath`
    - [ ] Add `--cache-size` CLI option
    - [ ] Add debug logging for cache hits/misses
    - [ ] Run `bun test`; confirm Q2 tests pass
    - [ ] Commit: `perf(queries): Add LRU result cache for repeated lookups`

- [ ] Task: Implement Q3 — Benchmark suite
    - [ ] Create `benchmark/` directory with `suite.ts`
    - [ ] Implement synthetic monorepo generator (10k `.ts` files, deterministic seed)
    - [ ] Implement `bench_scan_large` — measure full scan time
    - [ ] Implement `bench_deps_lookup` — measure 100 random `deps` queries
    - [ ] Implement `bench_callers_lookup` — measure 100 random `callers` queries
    - [ ] Implement `bench_path_finding` — measure 20 random `path` queries
    - [ ] Implement `bench_stats` — measure `stats` command latency
    - [ ] Implement JSON report writer to `benchmark/results/<timestamp>.json`
    - [ ] Run `bun test`; confirm Q4 tests pass
    - [ ] Commit: `perf(benchmark): Add benchmark suite with monorepo generator`

- [ ] Task: Implement Q4 — Benchmark CLI command
    - [ ] Add `repo-graph benchmark` CLI entry point
    - [ ] Implement threshold checking with exit code 1 on failure
    - [ ] Add `--output` flag for custom report path
    - [ ] Run `bun test`; confirm Q4 tests pass
    - [ ] Commit: `feat(cli): Add benchmark command with regression gate`

- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

---

## Phase 4 — Coverage, Generated Docs, Doctor & Install

- [ ] Task: Verify coverage ≥ 80%
    - [ ] `bun test --coverage`
    - [ ] All modified modules at or above threshold

- [ ] Task: Run generate script and commit if changed
    - [ ] `./measure/generate.sh`
    - [ ] `git diff --exit-code measure/generated/`

- [ ] Task: Run doctor script
    - [ ] `./measure/doctor.sh`
    - [ ] Fix any architectural violations

- [ ] Task: Rebuild executable and install to `~/.local/bin/`
    - [ ] `bun run build`
    - [ ] `cp ./bin/repo-graph ~/.local/bin/repo-graph`
    - [ ] Smoke test: run `repo-graph benchmark` and verify JSON output

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
