# Implementation Plan: Migration-Audit Graph Features

## Phase 1: Contract & Schema Definition

- [x] Task: Extend database schema for edge metadata [6d691cc]
  - [x] Add `metadata TEXT` column to `edges` table
  - [x] Add `route` to `NodeType` union in contract.ts
  - [x] Add `param_flow` to `EdgeType` union in contract.ts
  - [x] Verify backward compatibility: old DBs without `metadata` load gracefully
- [ ] Task: Define route node structure and ID convention
  - [ ] ID format: `route:<file_path>:<method>:<normalized_path>`
  - [ ] Node fields: method, params (JSON array), handler_name

## Phase 2: Test — String-Literal Tracking (FR1)

- [ ] Task: Write failing tests for string-literal extraction
  - [ ] Test: `fetch('/api/lessons')` creates edge with metadata `{ string_literal: "/api/lessons" }`
  - [ ] Test: `eq(scienceLessons.id, lessonSlug)` creates edge with metadata `{ column_ref: "scienceLessons.id", value_ref: "lessonSlug" }`
  - [ ] Test: `router.push('/courses/[id]')` captures URL string
  - [ ] Test: SQL template tag `` sql`SELECT * FROM users` `` captures query string
  - [ ] Test: Non-string arguments (variables, expressions) do NOT create metadata
- [ ] Task: Write failing tests for metadata querying
  - [ ] Test: `runQuery` can filter edges by metadata JSON content
  - [ ] Test: `search` finds edges by metadata substring

## Phase 3: Test — Param-Flow / Taint Edges (FR2)

- [ ] Task: Write failing tests for param-flow extraction
  - [ ] Test: Route handler `function handler({ lessonId })` creates param node `param:...:lessonId`
  - [ ] Test: Usage of `lessonId` inside `eq(scienceLessons.id, lessonId)` creates `param_flow` edge
  - [ ] Test: Multiple param usages in same function create multiple edges
  - [ ] Test: Params in nested callbacks are traced (e.g. `.map(id => ...)`)
- [ ] Task: Write failing tests for param-flow querying
  - [ ] Test: `deps` with `--downstream` from a param finds all usage sites
  - [ ] Test: `path` from route node to DB column node via param_flow works

## Phase 4: Test — Route Discovery (FR3)

- [ ] Task: Write failing tests for Next.js route extraction
  - [ ] Test: `app/api/lessons/route.ts` with exported `GET` creates route node
  - [ ] Test: `app/courses/[id]/page.tsx` creates route with params `["id"]`
- [ ] Task: Write failing tests for Hono route extraction
  - [ ] Test: `app.get('/api/lessons', handler)` creates route node
  - [ ] Test: `app.post('/api/lessons/:id', handler)` creates route with params `["id"]`
- [ ] Task: Write failing tests for tRPC route extraction
  - [ ] Test: `router.query('lessons.getById', resolver)` creates route node
  - [ ] Test: `router.mutation('lessons.create', resolver)` creates route node with method `MUTATION`
- [ ] Task: Write failing tests for Express-style route extraction
  - [ ] Test: `router.get('/lessons', handler)` creates route node

## Phase 5: Implement — String-Literal Tracking (FR1)

- [ ] Task: Implement string-literal scanner pass
  - [ ] Add `scanStringLiterals(project)` pass in scanner.ts
  - [ ] Detect `fetch()`, `axios.*()`, `router.push()`, `redirect()` calls
  - [ ] Detect Drizzle `eq()`, `where()`, `set()` calls
  - [ ] Detect Prisma `findUnique()`, `findMany()`, `update()` calls
  - [ ] Store string literal in edge metadata JSON
- [ ] Task: Wire metadata through DB insert
  - [ ] Update `handleScan` to insert metadata column
  - [ ] Update `updateFiles` to handle metadata
- [ ] Task: Add metadata search/filter to CLI
  - [ ] Extend `search` or add `query` examples for metadata filtering

## Phase 6: Implement — Param-Flow / Taint Edges (FR2)

- [ ] Task: Implement param-flow scanner pass
  - [ ] Add `scanParamFlow(project)` pass in scanner.ts
  - [ ] Identify route-handler-like functions (exported, in route files, or with param patterns)
  - [ ] Create `param` nodes for destructured params and typed params
  - [ ] Walk function body to find all references to each param
  - [ ] Create `param_flow` edges from param to usage site
- [ ] Task: Integrate param nodes with existing query commands
  - [ ] Ensure `resolveNode` finds param nodes by name
  - [ ] Ensure `deps`/`callers` traverse `param_flow` edges

## Phase 7: Implement — Route Discovery (FR3)

- [ ] Task: Implement route scanner pass for Next.js
  - [ ] Detect `app/**/route.ts` files with exported HTTP method handlers
  - [ ] Detect `app/**/page.tsx` files (implicit GET route)
  - [ ] Extract dynamic params from file path (`[id]`, `[[...slug]]`)
  - [ ] Extract method from export name (`GET`, `POST`, etc.)
- [ ] Task: Implement route scanner pass for Hono
  - [ ] Detect `app.get('/path', handler)` pattern
  - [ ] Detect `app.post('/path', handler)` pattern
  - [ ] Extract URL params from path string (`:id`, `:name`)
- [ ] Task: Implement route scanner pass for tRPC
  - [ ] Detect `router.query('name', resolver)` pattern
  - [ ] Detect `router.mutation('name', resolver)` pattern
  - [ ] Create route name from procedure path
- [ ] Task: Implement route scanner pass for Express
  - [ ] Detect `router.get('/path', handler)` pattern
  - [ ] Detect `router.post('/path', handler)` pattern
- [ ] Task: Add `search --type=route` filter support
  - [ ] Update `searchNodes` to accept type filter
  - [ ] Add `--type` CLI flag to search command

## Phase 8: Generate Docs & Doctor

- [ ] Task: Update README with new node types, edge types, and query examples
- [ ] Task: Run `bun test --coverage` and verify >90% for new modules
- [ ] Task: Build and install updated binary
- [ ] Task: Run smoke test on sample project with route + param_flow + string literals
- [ ] Task: Run smoke test on real monorepo to verify route discovery
- [ ] Task: Measure - User Manual Verification 'Phase 8' (Protocol in workflow.md)
