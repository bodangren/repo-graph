# Implementation Plan: Convenience Query Commands for build-graph

## Phase 1: Contract & Schema Definition

- [ ] Task: Define convenience command argument contracts
    - [ ] Document `deps`, `callers`, `path`, `stats`, `files` argument shapes
    - [ ] Define `--upstream` / `--downstream` flags for `deps`
    - [ ] Define ambiguous-match behavior (exit 2, print disambiguation list)
- [ ] Task: Add `meta` table to schema
    - [ ] Add `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)` to schema.ts
    - [ ] Add `project_root` key storage during scan/init
    - [ ] Add helper function `getProjectRoot(db)` for path stripping
- [ ] Task: Define relative path utility contract
    - [ ] Document path stripping logic (strip prefix, keep leading `./` optional)
- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Test

- [ ] Task: Write tests for `meta` table
    - [ ] Test `project_root` is stored during scan
    - [ ] Test `getProjectRoot` helper returns correct value
- [ ] Task: Write tests for relative path utility
    - [ ] Test absolute → relative conversion
    - [ ] Test paths outside root (edge case)
- [ ] Task: Write tests for `deps` command
    - [ ] Test finding upstream dependents by exact name
    - [ ] Test `--downstream` flag
    - [ ] Test ambiguous name → exit 2 with disambiguation list
    - [ ] Test no matches → empty result
- [ ] Task: Write tests for `callers` command
    - [ ] Test finding function callers
    - [ ] Test ambiguous name handling
- [ ] Task: Write tests for `path` command
    - [ ] Test tracing path between two nodes
    - [ ] Test no path found
    - [ ] Test ambiguous from/to names
- [ ] Task: Write tests for `stats` command
    - [ ] Test dashboard output contains expected sections
- [ ] Task: Write tests for `files` command
    - [ ] Test listing all files
    - [ ] Test pattern filtering
- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Implement

- [ ] Task: Add `meta` table and project root storage
    - [ ] Update `schema.ts` with `meta` table
    - [ ] Store `project_root` in `handleScan` and `handleInit`
    - [ ] Add `getProjectRoot(db)` helper in `query.ts` or new `meta.ts`
- [ ] Task: Implement relative path utility
    - [ ] Create `graphing-tools/paths.ts` with `toRelative(path, root)` function
    - [ ] Apply to all output in convenience commands
- [ ] Task: Implement node resolution utility
    - [ ] Create `resolveNode(db, name)` → single node or ambiguous list
    - [ ] Used by `deps`, `callers`, `path`
- [ ] Task: Implement `deps` command
    - [ ] SQL query for upstream dependents (default)
    - [ ] SQL query for downstream dependencies (`--downstream`)
    - [ ] Disambiguation logic
    - [ ] Table output with relative paths
- [ ] Task: Implement `callers` command
    - [ ] Reuse `deps` logic filtered to function-type edges
- [ ] Task: Implement `path` command
    - [ ] Recursive CTE for shortest path between two nodes
    - [ ] Format output as `A → B → C` chain
- [ ] Task: Implement `stats` command
    - [ ] Count queries for totals
    - [ ] GROUP BY queries for type breakdown
    - [ ] Top 10 most imported
    - [ ] Top 10 largest files
    - [ ] Package breakdown by directory prefix
    - [ ] ASCII bar chart for type counts
- [ ] Task: Implement `files` command
    - [ ] List files with entity counts (functions, classes, interfaces per file)
    - [ ] Pattern filter via `LIKE`
- [ ] Task: Wire all commands into CLI dispatcher
    - [ ] Update `cli.ts` with new subcommands
    - [ ] Update `build-graph.ts` main switch
    - [ ] Update help text
- [ ] Task: Build compiled executable
    - [ ] `bun run build`
    - [ ] Verify executable runs standalone
- [ ] Task: Update README.md
    - [ ] Document all new convenience commands with examples
- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Generate Docs & Doctor

- [ ] Task: Run `./measure/generate.sh`
    - [ ] Verify `measure/generated/` is updated
    - [ ] Commit generated docs
- [ ] Task: Run `./measure/doctor.sh`
    - [ ] Fix any ESLint errors
    - [ ] Fix any boundary violations
    - [ ] Fix any stale generated docs
- [ ] Task: Run test suite with coverage
    - [ ] `CI=true bun test --coverage`
    - [ ] Verify >80% coverage
    - [ ] Fix any coverage gaps
- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
