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

## Phase 3: Implement

- [ ] Task: Install `ts-morph` dependency
    - [ ] `bun add ts-morph`
    - [ ] Update `tech-stack.md` with exact version
- [ ] Task: Rewrite CLI entry point (`build-graph-db.ts` → `build-graph.ts`)
    - [ ] Implement subcommand dispatcher
    - [ ] Implement `--help` and `--version` flags
    - [ ] Implement error handling with correct exit codes
- [ ] Task: Implement `init` command
    - [ ] Reuse `createSchema()` and `createIndexes()` from existing `schema.ts`/`indexes.ts`
    - [ ] Add idempotent `CREATE TABLE IF NOT EXISTS` wrappers
- [ ] Task: Implement scanner module (`scanner.ts`)
    - [ ] Create `ts-morph` Project from `tsconfig.json`
    - [ ] Extract file nodes
    - [ ] Extract function nodes (declarations + arrow functions + methods)
    - [ ] Extract class nodes + extends/implements edges
    - [ ] Extract interface nodes
    - [ ] Extract type alias nodes
    - [ ] Extract import edges (resolve relative paths)
    - [ ] Extract contains edges (file → child nodes)
    - [ ] Extract JSDoc summaries
    - [ ] Extract line numbers
    - [ ] Compute layer_id from directory structure
    - [ ] Batch insert into SQLite with transaction
    - [ ] Print progress to stderr
- [ ] Task: Implement `query` command
    - [ ] Execute SQL against `graph.db`
    - [ ] Format results as table
    - [ ] Support `--json` flag for machine-readable output
- [ ] Task: Implement `search` command
    - [ ] Build parameterized SQL query with `LOWER()` + `LIKE`
    - [ ] Format results as table
- [ ] Task: Implement `update` command
    - [ ] Delete existing nodes/edges for changed files
    - [ ] Re-parse and re-insert
    - [ ] Wrap in transaction
- [ ] Task: Build compiled executable
    - [ ] Add `build` script to `package.json`: `bun build --compile ./graphing-tools/build-graph.ts --outfile ./bin/build-graph`
    - [ ] Verify executable runs standalone
- [ ] Task: Update `graphing-tools/README.md`
    - [ ] Document all subcommands with examples
    - [ ] Document git hook integration
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
