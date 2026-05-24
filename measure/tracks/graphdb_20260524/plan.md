# Implementation Plan: graphdb_20260524

## Phase 1: Bootstrap & CLI [checkpoint: fa00011]

- [x] Task: Set up CLI entry point with argument parsing [6d5a54b]
    - [x] Write unit tests for CLI argument validation (missing args, bad paths)
    - [x] Implement `build-graph-db.ts` CLI with `Bun.argv` parsing
- [x] Task: Set up project layout and TypeScript configuration [b5d099c]
    - [x] Write tests for module resolution and imports
    - [x] Create `tsconfig.json` and reorganize `graphing-tools/` for TypeScript
- [x] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

## Phase 2: Schema & Database Setup [checkpoint: 99fd258]

- [x] Task: Create SQLite schema builder [017606c]
    - [x] Write unit tests for schema creation (table names, column types)
    - [x] Implement schema execution via `bun:sqlite` matching `measure/tech-stack.md`
- [x] Task: Build index creation [c2e39e2]
    - [x] Write unit tests verifying all indexes exist after creation
    - [x] Implement index creation statements
- [x] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

## Phase 3: Data Ingestion [checkpoint: f653298]

- [x] Task: Implement nodes table ingestion [39acc86]
    - [x] Write unit tests for node insertion and batch behavior
    - [x] Implement prepared statement batch insert for nodes with transaction wrapping
- [x] Task: Implement edges table ingestion [9b09b4c]
    - [x] Write unit tests for edge insertion and foreign key sanity
    - [x] Implement prepared statement batch insert for edges with transaction wrapping
- [x] Task: Implement layers and tour_steps ingestion [548e653]
    - [x] Write unit tests for layers/tour_steps insertion
    - [x] Implement batch insert for layers and tour_steps
- [x] Task: Implement layer_id resolution on nodes [548e653]
    - [x] Write unit tests verifying `nodes.layer_id` is correctly populated from `layers.node_ids`
    - [x] Implement UPDATE query to resolve and set `layer_id`
- [x] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

## Phase 4: Integration & Polish

- [x] Task: Wire up full pipeline (JSON → SQLite) [a2a35f0]
    - [x] Write integration test with a sample `knowledge-graph.json`
    - [x] Implement orchestration function that runs schema → ingestion → resolution in order
- [~] Task: Add error handling and diagnostics
    - [ ] Write tests for error cases (missing file, invalid JSON, missing fields, DB locked)
    - [ ] Implement verbose error messages with context and next steps
- [ ] Task: Write README for graphing-tools/
    - [ ] Document usage, CLI args, exit codes, and schema overview
- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
