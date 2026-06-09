# Implementation Plan: Scanner Enrichment — Runtime Schema & Framework-Aware Edge Extraction

Features are implemented in dependency order: schema changes first, then scanner passes, then query support. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Schema

Update `contract.ts` and `schema.ts` to support new node types, edge types, and package_id before writing any tests or implementation.

- [ ] Task: Expand `NodeType` and `EdgeType` unions
    - [ ] Add `"schema"` and `"field"` to `NodeType`
    - [ ] Add `"has_field"`, `"references"`, `"renders"`, `"uses_hook"`, `"queries"`, `"mutates"` to `EdgeType`
    - [ ] Add `package_id?: string` to `GraphNode`

- [ ] Task: Update database schema
    - [ ] Add `package_id TEXT` to `nodes` table in `schema.ts`
    - [ ] Add `package_id` parameter to `insertNode` in `build-graph.ts`

- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Tests (Red Phase)

Write all failing tests before touching scanner implementation.

- [ ] Task: Tests S1 — Runtime schema extraction (`scanner.test.ts`)
    - [ ] Add: `scanSchemas` extracts a `defineTable` call as a schema node with field children
    - [ ] Add: `scanSchemas` extracts a `z.object` call as a schema node with field children
    - [ ] Add: `scanSchemas` extracts a plain exported const object as a config schema
    - [ ] Add: `v.id("users")` produces a `references` edge to the `users` schema
    - [ ] Add: Nested objects inside schema fields are handled gracefully (flattened or skipped)

- [ ] Task: Tests S2 — Framework-aware edges (`scanner.test.ts`)
    - [ ] Add: JSX `<Component />` inside a function produces a `renders` edge
    - [ ] Add: `useHook()` call inside a function produces a `uses_hook` edge
    - [ ] Add: `useQuery(api.module.fn)` produces a `queries` edge
    - [ ] Add: `useMutation(api.module.fn)` produces a `mutates` edge

- [ ] Task: Tests S3 — Package labeling (`scanner.test.ts` or `build-graph.test.ts`)
    - [ ] Add: Nodes scanned from a file under `frontend/tsconfig.json` have `package_id = "frontend"`
    - [ ] Add: Nodes with no tsconfig mapping have `package_id = "root"`

- [ ] Task: Tests S4 — Package-filtered queries (`commands.test.ts`)
    - [ ] Add: `runDeps` with `fromPackage` filter returns only matching nodes
    - [ ] Add: `runDeps` with `toPackage` filter returns only matching nodes
    - [ ] Add: `runCallers` with `fromPackage` filter works correctly

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

- [ ] Task: Implement S3 — Package labeling in scanner
    - [ ] Map each source file to its originating tsconfig path during project creation
    - [ ] Derive `package_id` from tsconfig parent directory name
    - [ ] Thread `package_id` through `addNode` in `scanProject`
    - [ ] Update `build-graph.ts` insertNode to include `package_id`
    - [ ] Run `bun test`; confirm S3 tests pass
    - [ ] Commit: `feat(scanner): Label nodes with package_id from tsconfig boundary`

- [ ] Task: Implement S1 — Runtime schema extraction pass
    - [ ] Create `scanSchemas.ts` with `extractSchemaNodes` function
    - [ ] Detect `defineTable({ ... })` calls — extract schema name and fields
    - [ ] Detect `z.object({ ... })` calls — extract schema name and fields
    - [ ] Detect exported const object literals — extract config name and fields
    - [ ] Detect `v.id("tableName")` references and emit `references` edges
    - [ ] Integrate into `scanProject` after main AST scan
    - [ ] Run `bun test`; confirm S1 tests pass
    - [ ] Commit: `feat(scanner): Extract runtime schema builders as graph nodes`

- [ ] Task: Implement S2 — Framework-aware edge extraction pass
    - [ ] Create `scanFramework.ts` with `extractFrameworkEdges` function
    - [ ] Detect JSX element references inside functions — emit `renders` edges
    - [ ] Detect `useHook()` calls — emit `uses_hook` edges
    - [ ] Detect `useQuery(api.x.y)` and `useMutation(api.x.y)` — emit `queries` / `mutates` edges
    - [ ] Integrate into `scanProject` after main AST scan
    - [ ] Run `bun test`; confirm S2 tests pass
    - [ ] Commit: `feat(scanner): Detect framework-specific call patterns as typed edges`

- [ ] Task: Implement S4 — Package-filtered queries
    - [ ] Add `--from-package` and `--to-package` to `deps` and `callers` CLI parsing
    - [ ] Add `fromPackage` / `toPackage` options to `runDeps` and `runCallers`
    - [ ] Apply `package_id` filter in SQL queries via JOIN on nodes table
    - [ ] Add package breakdown to `runStats` output
    - [ ] Run `bun test`; confirm S4 tests pass
    - [ ] Commit: `feat(commands): Add --from-package and --to-package filters`

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
    - [ ] `cp ./bin/build-graph ~/.local/bin/build-graph`
    - [ ] Smoke test: scan a real project and inspect schema nodes

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
