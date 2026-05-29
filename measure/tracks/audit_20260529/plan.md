# Implementation Plan: Graph Integrity Audit Command

## Phase S1: Detect Missing Files
_Story ref: spec.md#story-s1_

### Contract & Schema Definition
- [ ] Task: Extend CLI contract for audit command
  - [ ] Add `"audit"` to `Subcommand` union type in `contract.ts`
  - [ ] Define `AuditArgs` interface (`dbPath: string`, `json?: boolean`)
  - [ ] Update `ParsedArgs` union with `{ subcommand: "audit"; args: AuditArgs }`
  - [ ] Add `"audit"` to `ExitCode` usage docs if needed

### Test
- [ ] Task: Write unit tests for missing-file detection
  - [ ] Create `audit.test.ts` with test fixtures
  - [ ] Test: database with a file node pointing to a deleted file → reports missing file
  - [ ] Test: database with all files present → reports clean
  - [ ] Test: `--json` output shape matches spec
  - [ ] Run tests and confirm they fail (Red phase)

### Implement
- [ ] Task: Implement missing-file audit check
  - [ ] Add `"audit"` parsing to `cli.ts` `parseArgs`
  - [ ] Create `audit.ts` module with `runAuditMissingFiles(db, opts?)` function
  - [ ] Query all `file` nodes from database
  - [ ] Check `fs.existsSync` for each `file_path`
  - [ ] Return structured results for table and JSON formatting
  - [ ] Wire `handleAudit` into `build-graph.ts` `main` switch statement
  - [ ] Add `audit` help text to `printHelp`
  - [ ] Run tests and confirm they pass (Green phase)

### Generate Docs & Doctor
- [ ] Task: Update generated facts and run architecture linter
  - [ ] Run `measure/generate.sh` to update generated docs
  - [ ] Run `measure/doctor.sh` and fix any violations
  - [ ] Verify `git diff --exit-code measure/generated/` passes

- [ ] Task: Measure - User Manual Verification 'Phase S1: Detect Missing Files' (Protocol in workflow.md)

---

## Phase S2: Detect Stale Symbols
_Story ref: spec.md#story-s2_

### Contract & Schema Definition
- [ ] Task: Define stale-symbol detection contract
  - [ ] Add `stale_symbol` result type to audit output contract
  - [ ] Document ts-morph re-parsing strategy in code comments

### Test
- [ ] Task: Write unit tests for stale-symbol detection
  - [ ] Test: function node exists in graph but source file no longer has that function → flagged stale
  - [ ] Test: class node renamed in source → old node flagged stale
  - [ ] Test: interface still exists → not flagged
  - [ ] Test: arrow-function variable still exists → not flagged
  - [ ] Run tests and confirm they fail (Red phase)

### Implement
- [ ] Task: Implement stale-symbol audit check
  - [ ] Extend `audit.ts` with `runAuditStaleSymbols(db, project)`
  - [ ] Group symbol nodes by `file_path`
  - [ ] Load each source file via ts-morph (reuse `createProject` from `build-graph.ts`)
  - [ ] For each symbol type (`function`, `class`, `interface`, `type_alias`, `schema`, `field`, `route`, `param`), query the AST:
    - `function`: check `sourceFile.getFunctions()` and arrow-function variable declarations
    - `class`: check `sourceFile.getClasses()`
    - `interface`: check `sourceFile.getInterfaces()`
    - `type_alias`: check `sourceFile.getTypeAliases()`
    - `schema`/`field`: reuse `scanSchemas` or check manually for `defineTable`/`z.object`
    - `route`: check route patterns in `scanRoutes`
    - `param`: check parameter declarations
  - [ ] Report nodes whose `name` is not found in the parsed AST at the expected location
  - [ ] Integrate into `runAudit` orchestrator function
  - [ ] Run tests and confirm they pass (Green phase)

### Generate Docs & Doctor
- [ ] Task: Update generated facts and run architecture linter
  - [ ] Run `measure/generate.sh`
  - [ ] Run `measure/doctor.sh`

- [ ] Task: Measure - User Manual Verification 'Phase S2: Detect Stale Symbols' (Protocol in workflow.md)

---

## Phase S3: Detect Orphan Edges
_Story ref: spec.md#story-s3_

### Contract & Schema Definition
- [ ] Task: Define orphan-edge result type
  - [ ] Add `orphan_edge` result type to audit output contract

### Test
- [ ] Task: Write unit tests for orphan-edge detection
  - [ ] Test: edge with `source` pointing to deleted node → flagged
  - [ ] Test: edge with `target` pointing to deleted node → flagged
  - [ ] Test: edge where both source and target exist → not flagged
  - [ ] Run tests and confirm they fail (Red phase)

### Implement
- [ ] Task: Implement orphan-edge audit check
  - [ ] Extend `audit.ts` with `runAuditOrphanEdges(db)`
  - [ ] SQL query: `SELECT e.* FROM edges e LEFT JOIN nodes ns ON ns.id = e.source LEFT JOIN nodes nt ON nt.id = e.target WHERE ns.id IS NULL OR nt.id IS NULL`
  - [ ] Include edge type and which side is missing in the report
  - [ ] Integrate into `runAudit` orchestrator
  - [ ] Run tests and confirm they pass (Green phase)

### Generate Docs & Doctor
- [ ] Task: Update generated facts and run architecture linter
  - [ ] Run `measure/generate.sh`
  - [ ] Run `measure/doctor.sh`

- [ ] Task: Measure - User Manual Verification 'Phase S3: Detect Orphan Edges' (Protocol in workflow.md)

---

## Phase S4: Detect Duplicate Nodes
_Story ref: spec.md#story-s4_

### Contract & Schema Definition
- [ ] Task: Define duplicate-node result type
  - [ ] Add `duplicate_node` result type to audit output contract

### Test
- [ ] Task: Write unit tests for duplicate-node detection
  - [ ] Test: two nodes with same name+type+file_path → flagged as duplicate group
  - [ ] Test: nodes with same name but different types → not flagged
  - [ ] Test: nodes with same name+type but different files → not flagged
  - [ ] Run tests and confirm they fail (Red phase)

### Implement
- [ ] Task: Implement duplicate-node audit check
  - [ ] Extend `audit.ts` with `runAuditDuplicateNodes(db)`
  - [ ] SQL query: `SELECT name, type, file_path, COUNT(*) AS c, GROUP_CONCAT(id) AS ids FROM nodes GROUP BY name, type, file_path HAVING c > 1`
  - [ ] Parse `GROUP_CONCAT` result into array of duplicate ids
  - [ ] Integrate into `runAudit` orchestrator
  - [ ] Run tests and confirm they pass (Green phase)

### Generate Docs & Doctor
- [ ] Task: Update generated facts and run architecture linter
  - [ ] Run `measure/generate.sh`
  - [ ] Run `measure/doctor.sh`

- [ ] Task: Measure - User Manual Verification 'Phase S4: Detect Duplicate Nodes' (Protocol in workflow.md)

---

## Phase S5: Integration & Orchestration
_Story ref: Track-level acceptance criteria_

### Contract & Schema Definition
- [ ] Task: Finalize audit orchestrator contract
  - [ ] Define `AuditResult` union type encompassing all four check result types
  - [ ] Define exit-code behavior: `0` = clean, `1` = issues found

### Test
- [ ] Task: Write integration tests for full audit command
  - [ ] Test: clean database → exit code 0 and empty report
  - [ ] Test: database with one issue of each type → exit code 1 and comprehensive report
  - [ ] Test: `--json` flag produces valid JSON
  - [ ] Test: human-readable output uses `formatTable`
  - [ ] Test: `build-graph help audit` prints usage
  - [ ] Run tests and confirm they fail (Red phase)

### Implement
- [ ] Task: Implement audit orchestrator and wiring
  - [ ] Create `runAudit(db, opts?)` in `audit.ts` that calls all four checks
  - [ ] Aggregate results across checks
  - [ ] Format output using existing `formatTable` for human mode
  - [ ] Format output as structured JSON for `--json` mode
  - [ ] Return appropriate exit code
  - [ ] Add `handleAudit` to `build-graph.ts`
  - [ ] Update `printHelp` with `audit` subcommand documentation
  - [ ] Run tests and confirm they pass (Green phase)

### Generate Docs & Doctor
- [ ] Task: Final verification
  - [ ] Run full test suite `CI=true bun test`
  - [ ] Verify coverage >80% for `audit.ts`
  - [ ] Run `measure/generate.sh`
  - [ ] Run `measure/doctor.sh`
  - [ ] Commit all changes

- [ ] Task: Measure - User Manual Verification 'Phase S5: Integration & Orchestration' (Protocol in workflow.md)
