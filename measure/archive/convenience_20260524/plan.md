# Implementation Plan: Convenience Query Commands for build-graph

## Phase 1: Contract & Schema Definition

- [x] Task: Define convenience command argument contracts
    - [x] Document `deps`, `callers`, `path`, `stats`, `files` argument shapes
    - [x] Define `--upstream` / `--downstream` flags for `deps`
    - [x] Define ambiguous-match behavior (exit 2, print disambiguation list)
- [x] Task: Add `meta` table to schema
    - [x] Add `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)` to schema.ts
    - [x] Add `project_root` key storage during scan/init
    - [x] Add helper function `getProjectRoot(db)` for path stripping
- [x] Task: Define relative path utility contract
    - [x] Document path stripping logic (strip prefix, keep leading `./` optional)
- [x] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Test

- [x] Task: Write tests for `meta` table
    - [x] Test `project_root` is stored during scan
    - [x] Test `getProjectRoot` helper returns correct value
- [x] Task: Write tests for relative path utility
    - [x] Test absolute → relative conversion
    - [x] Test paths outside root (edge case)
- [x] Task: Write tests for `deps` command
    - [x] Test finding upstream dependents by exact name
    - [x] Test `--downstream` flag
    - [x] Test ambiguous name → exit 2 with disambiguation list
    - [x] Test no matches → empty result
- [x] Task: Write tests for `callers` command
    - [x] Test finding function callers
    - [x] Test ambiguous name handling
- [x] Task: Write tests for `path` command
    - [x] Test tracing path between two nodes
    - [x] Test no path found
    - [x] Test ambiguous from/to names
- [x] Task: Write tests for `stats` command
    - [x] Test dashboard output contains expected sections
- [x] Task: Write tests for `files` command
    - [x] Test listing all files
    - [x] Test pattern filtering
- [x] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Implement

- [x] Task: Add `meta` table and project root storage
    - [x] Update `schema.ts` with `meta` table
    - [x] Store `project_root` in `handleScan` and `handleInit`
    - [x] Add `getProjectRoot(db)` helper in `query.ts` or new `meta.ts`
- [x] Task: Implement relative path utility
    - [x] Create `graphing-tools/paths.ts` with `toRelative(path, root)` function
    - [x] Apply to all output in convenience commands
- [x] Task: Implement node resolution utility
    - [x] Create `resolveNode(db, name)` → single node or ambiguous list
    - [x] Used by `deps`, `callers`, `path`
- [x] Task: Implement `deps` command
    - [x] SQL query for upstream dependents (default)
    - [x] SQL query for downstream dependencies (`--downstream`)
    - [x] Disambiguation logic
    - [x] Table output with relative paths
- [x] Task: Implement `callers` command
    - [x] Reuse `deps` logic filtered to function-type edges
- [x] Task: Implement `path` command
    - [x] Recursive CTE for shortest path between two nodes
    - [x] Format output as `A → B → C` chain
- [x] Task: Implement `stats` command
    - [x] Count queries for totals
    - [x] GROUP BY queries for type breakdown
    - [x] Top 10 most imported
    - [x] Top 10 largest files
    - [x] Package breakdown by directory prefix
    - [x] ASCII bar chart for type counts
- [x] Task: Implement `files` command
    - [x] List files with entity counts (functions, classes, interfaces per file)
    - [x] Pattern filter via `LIKE`
- [x] Task: Wire all commands into CLI dispatcher
    - [x] Update `cli.ts` with new subcommands
    - [x] Update `build-graph.ts` main switch
    - [x] Update help text
- [x] Task: Build compiled executable
    - [x] `bun run build`
    - [x] Verify executable runs standalone
- [x] Task: Update README.md
    - [x] Document all new convenience commands with examples
- [x] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Generate Docs & Doctor

- [x] Task: Run `./measure/generate.sh`
    - [x] Verify `measure/generated/` is updated
    - [x] Commit generated docs
- [x] Task: Run `./measure/doctor.sh`
    - [x] Fix any ESLint errors
    - [x] Fix any boundary violations
    - [x] Fix any stale generated docs
- [x] Task: Run test suite with coverage
    - [x] `CI=true bun test --coverage`
    - [x] Verify >80% coverage
    - [x] Fix any coverage gaps
- [x] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
