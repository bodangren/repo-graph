# Implementation Plan: Build the `build-graph` CLI Tool

## Phase 1: Contract & Schema Definition [checkpoint: cf3cd13]

- [x] Task: Define CLI command contract
    - [x] Document argument parsing for all subcommands (init, scan, update, query, search)
    - [x] Define exit codes and error messages
    - [x] Define progress output format (stderr) for scan/update
- [x] Task: Update SQLite schema for scanner needs
    - [x] Add `line_start` and `line_end` columns to `nodes` table
    - [x] Verify node type enum covers: file, function, class, interface, type_alias
    - [x] Verify edge type enum covers: contains, imports, extends, implements
    - [x] Ensure `file_path` is NOT NULL (every node belongs to a file)
- [x] Task: Define scanner output contract
    - [x] Document node ID format: `<type>:<file_path>:<name>` (or `file:<file_path>` for files)
    - [x] Document edge source/target format
    - [x] Document layer_id heuristic: derived from directory structure (e.g., `src/auth/` → `layer:auth`)
- [x] Task: Define query/search output format
    - [x] Document table formatter (column widths, truncation, header style)
    - [x] Document JSON output option (`--json` flag for piping)
- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Test [checkpoint: 59a77d8]

- [x] Task: Write tests for CLI argument parsing
    - [x] Test each subcommand with valid arguments
    - [x] Test missing arguments → exit code 2
    - [x] Test unknown subcommand → exit code 2
    - [x] Test `--help` for each subcommand
- [x] Task: Write tests for scanner module
    - [x] Create mock `ts-morph` source files in test fixtures
    - [x] Test extraction of functions, classes, interfaces, type aliases
    - [x] Test import resolution (relative paths)
    - [x] Test edge creation (contains, imports, extends, implements)
    - [x] Test JSDoc summary extraction
    - [x] Test line number extraction
- [x] Task: Write tests for query command
    - [x] Test valid SQL execution
    - [x] Test invalid SQL → exit code 1
    - [x] Test empty result set handling
    - [x] Test table formatter output
- [x] Task: Write tests for search command
    - [x] Test keyword matching in name, summary, tags
    - [x] Test case-insensitive search
    - [x] Test limit of 20 results
    - [x] Test empty search
- [x] Task: Write tests for update command
    - [x] Test incremental delete + re-insert for changed files
    - [x] Test transaction rollback on error
- [x] Task: Write integration test
    - [x] Full scan of a sample TypeScript project
    - [x] Verify node count, edge count, and specific node existence
    - [x] Verify query returns correct results
    - [x] Verify update modifies only specified files
- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Implement [checkpoint: 0847628]

- [x] Task: Install `ts-morph` dependency
    - [x] `bun add ts-morph`
    - [x] Update `tech-stack.md` with exact version
- [x] Task: Rewrite CLI entry point (`build-graph-db.ts` → `build-graph.ts`)
    - [x] Implement subcommand dispatcher
    - [x] Implement `--help` and `--version` flags
    - [x] Implement error handling with correct exit codes
- [x] Task: Implement `init` command
    - [x] Reuse `createSchema()` and `createIndexes()` from existing `schema.ts`/`indexes.ts`
    - [x] Add idempotent `CREATE TABLE IF NOT EXISTS` wrappers
- [x] Task: Implement scanner module (`scanner.ts`)
    - [x] Create `ts-morph` Project from `tsconfig.json`
    - [x] Extract file nodes
    - [x] Extract function nodes (declarations + arrow functions + methods)
    - [x] Extract class nodes + extends/implements edges
    - [x] Extract interface nodes
    - [x] Extract type alias nodes
    - [x] Extract import edges (resolve relative paths)
    - [x] Extract contains edges (file → child nodes)
    - [x] Extract JSDoc summaries
    - [x] Extract line numbers
    - [x] Compute layer_id from directory structure
    - [x] Batch insert into SQLite with transaction
    - [x] Print progress to stderr
- [x] Task: Implement `query` command
    - [x] Execute SQL against `graph.db`
    - [x] Format results as table
    - [x] Support `--json` flag for machine-readable output
- [x] Task: Implement `search` command
    - [x] Build parameterized SQL query with `LOWER()` + `LIKE`
    - [x] Format results as table
- [x] Task: Implement `update` command
    - [x] Delete existing nodes/edges for changed files
    - [x] Re-parse and re-insert
    - [x] Wrap in transaction
- [x] Task: Build compiled executable
    - [x] Add `build` script to `package.json`: `bun build --compile ./graphing-tools/build-graph.ts --outfile ./bin/build-graph`
    - [x] Verify executable runs standalone
- [x] Task: Update `graphing-tools/README.md`
    - [x] Document all subcommands with examples
    - [x] Document git hook integration
- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

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
    - [x] Verify >80% coverage (91.06%)
    - [x] Fix any coverage gaps
- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
