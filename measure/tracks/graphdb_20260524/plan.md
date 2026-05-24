# Implementation Plan: graphdb_20260524

## Phase 1: Bootstrap & CLI [checkpoint: fa00011]

- [x] Task: Set up CLI entry point with argument parsing [6d5a54b]
    - [x] Write unit tests for CLI argument validation (missing args, bad paths)
    - [x] Implement `build-graph-db.ts` CLI with `Bun.argv` parsing
- [x] Task: Set up project layout and TypeScript configuration [b5d099c]
    - [x] Write tests for module resolution and imports
    - [x] Create `tsconfig.json` and reorganize `graphing-tools/` for TypeScript
- [x] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Schema & Database Setup

- [~] Task: Create SQLite schema builder
    - [ ] Write unit tests for schema creation (table names, column types)
    - [ ] Implement schema execution via `bun:sqlite` matching `measure/tech-stack.md`
- [ ] Task: Build index creation
    - [ ] Write unit tests verifying all indexes exist after creation
    - [ ] Implement index creation statements
- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Data Ingestion

- [ ] Task: Implement nodes table ingestion
    - [ ] Write unit tests for node insertion and batch behavior
    - [ ] Implement prepared statement batch insert for nodes with transaction wrapping
- [ ] Task: Implement edges table ingestion
    - [ ] Write unit tests for edge insertion and foreign key sanity
    - [ ] Implement prepared statement batch insert for edges with transaction wrapping
- [ ] Task: Implement layers and tour_steps ingestion
    - [ ] Write unit tests for layers/tour_steps insertion
    - [ ] Implement batch insert for layers and tour_steps
- [ ] Task: Implement layer_id resolution on nodes
    - [ ] Write unit tests verifying `nodes.layer_id` is correctly populated from `layers.node_ids`
    - [ ] Implement UPDATE query to resolve and set `layer_id`
- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Integration & Polish

- [ ] Task: Wire up full pipeline (JSON → SQLite)
    - [ ] Write integration test with a sample `knowledge-graph.json`
    - [ ] Implement orchestration function that runs schema → ingestion → resolution in order
- [ ] Task: Add error handling and diagnostics
    - [ ] Write tests for error cases (missing file, invalid JSON, missing fields, DB locked)
    - [ ] Implement verbose error messages with context and next steps
- [ ] Task: Write README for graphing-tools/
    - [ ] Document usage, CLI args, exit codes, and schema overview
- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
