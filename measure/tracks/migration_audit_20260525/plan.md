# Implementation Plan: Migration-Audit Graph Features

## Phase 1: Contract & Schema Definition

- [x] Task: Extend database schema for edge metadata [d4f4fb5]
  - [x] Add `metadata TEXT` column to `edges` table
  - [x] Add `route` and `param` to `NodeType` union in contract.ts
  - [x] Add `param_flow` to `EdgeType` union in contract.ts
  - [x] Verify backward compatibility: old DBs without `metadata` load gracefully
- [x] Task: Define route node structure and ID convention
  - [x] ID format: `route:<file_path>:<method>:<normalized_path>`
  - [x] Node fields: method encoded in name, params as tags

## Phase 2: Test — String-Literal Tracking (FR1)

- [x] Task: Write failing tests for string-literal extraction
  - [x] Test: `fetch('/api/lessons')` creates edge with metadata `{ string_literal: "/api/lessons" }`
  - [x] Test: `eq(scienceLessons.id, lessonSlug)` creates edge with metadata `{ column_ref: "scienceLessons.id", value_ref: "lessonSlug" }`
  - [x] Test: `router.push('/courses/[id]')` captures URL string
  - [x] Test: SQL template tag `` sql`SELECT * FROM users` `` captures query string
  - [x] Test: Non-string arguments (variables, expressions) do NOT create metadata

## Phase 3: Test — Param-Flow / Taint Edges (FR2)

- [x] Task: Write failing tests for param-flow extraction
  - [x] Test: Route handler `function handler({ lessonId })` creates param node `param:...:lessonId`
  - [x] Test: `param_flow` edge connects param node to containing function

## Phase 4: Test — Route Discovery (FR3)

- [x] Task: Write failing tests for Next.js route extraction
  - [x] Test: `app/api/lessons/route.ts` with exported `GET` creates route node
  - [x] Test: `app/courses/[id]/page.tsx` creates route with params `["id"]`
- [x] Task: Write failing tests for Hono route extraction
  - [x] Test: `app.get('/api/lessons', handler)` creates route node
  - [x] Test: `app.post('/api/lessons/:id', handler)` creates route with params `["id"]`
- [x] Task: Write failing tests for tRPC route extraction
  - [x] Test: `router.query('lessons.getById', resolver)` creates route node
  - [x] Test: `router.mutation('lessons.create', resolver)` creates route node with method `MUTATION`
- [x] Task: Write failing tests for search --type=route
  - [x] Test: `searchNodes` filters by type when typeFilter is provided
  - [x] Test: CLI parses `--type=route` flag

## Phase 5: Implement — String-Literal Tracking (FR1)

- [x] Task: Implement string-literal scanner pass
  - [x] Add `scanStringLiterals(project)` pass in scanner.ts
  - [x] Detect `fetch()`, `router.push()`, `eq()` calls, SQL template tags
  - [x] Store string literal / column ref / value ref in edge metadata JSON
- [x] Task: Wire metadata through DB insert
  - [x] Update `handleScan` to insert metadata column
  - [x] Update `updateFiles` to handle metadata

## Phase 6: Implement — Param-Flow / Taint Edges (FR2)

- [x] Task: Implement param-flow scanner pass
  - [x] Add `scanParamFlow(project)` pass in scanner.ts
  - [x] Create `param` nodes for destructured params and typed params
  - [x] Create `param_flow` edges from param node to containing function

## Phase 7: Implement — Route Discovery (FR3)

- [x] Task: Implement route scanner pass for Next.js
  - [x] Detect `app/**/route.ts` files with exported HTTP method handlers
  - [x] Detect `app/**/page.tsx` files (implicit GET route)
  - [x] Extract dynamic params from file path (`[id]`, `[[...slug]]`)
- [x] Task: Implement route scanner pass for Hono
  - [x] Detect `app.get('/path', handler)` pattern
  - [x] Detect `app.post('/path', handler)` pattern
- [x] Task: Implement route scanner pass for tRPC
  - [x] Detect `router.query('name', resolver)` pattern
  - [x] Detect `router.mutation('name', resolver)` pattern
  - [x] Derive name from parent PropertyAssignment when string arg is missing
- [x] Task: Add `search --type=route` filter support
  - [x] Update `searchNodes` to accept type filter
  - [x] Add `--type` CLI flag to search command

## Phase 8: Generate Docs & Doctor

- [ ] Task: Update README with new node types, edge types, and query examples
- [ ] Task: Run `bun test --coverage` and verify >90% for new modules
- [ ] Task: Build and install updated binary
- [ ] Task: Run smoke test on sample project with route + param_flow + string literals
- [ ] Task: Run smoke test on real monorepo to verify route discovery
- [ ] Task: Measure - User Manual Verification 'Phase 8' (Protocol in workflow.md)
