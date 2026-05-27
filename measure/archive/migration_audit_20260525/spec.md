# Specification: Migration-Audit Graph Features

## Overview

The scannerfix track fixed data-quality bugs in the existing edge types. This track adds three new capabilities that make schema migrations (e.g. Prisma → Drizzle) self-auditing. The goal: replace 6-grep + 4-file-read round trips with 2 graph queries.

The recurring bug pattern: `eq(scienceLessons.id, lessonSlug)` — querying a UUID column with a slug-shaped URL param. Today finding this requires manual grep. With these features, it becomes:

```bash
build-graph path graph.db route:/courses/[lessonId] field:scienceLessons.id
```

## Functional Requirements

### FR1: String-Literal Tracking on Edges

Track string arguments to known sinks and store the literal value as edge metadata.

**Known sinks to instrument:**
- `fetch('/api/...')`, `axios.get('/api/...')` — HTTP request URLs
- `router.push('/...')`, `redirect('/...')` — navigation targets
- SQL template tags: `` sql`SELECT ...` ``, `db.query(...)`
- Drizzle ORM: `eq(table.col, value)`, `where(eq(...))`, `set({...})`
- Prisma ORM: `prisma.table.findUnique({ where: { id: value } })`

**Storage format:**
- Add `metadata TEXT` column to `edges` table (JSON blob)
- Store `{ string_literal: "/api/lessons/123" }` or `{ column_ref: "scienceLessons.id", value: "lessonSlug" }`

**Query examples:**
- `build-graph query graph.db "SELECT * FROM edges WHERE metadata LIKE '%/api/lessons%'`"
- `build-graph search graph.db "eq(scienceLessons.id"` → find all call sites

### FR2: Param-Flow / Taint-Style Edges

Edge type `param_flow` from a function parameter to every expression that uses it within the function body.

**Scope:** Route handlers, API procedures, and any function whose parameter name matches a known pattern (`*Id`, `*Slug`, `params.*`, `req.*`).

**Semantics:**
- Source: `function:/path:handler` parameter node (new node type `param` or tag on function)
- Target: any expression node where the parameter is referenced
- Edge metadata: `{ param_name: "lessonId", sink_type: "drizzle_eq" }`

**Query examples:**
- `build-graph deps graph.db lessonId --downstream` → all expressions using `lessonId`
- `build-graph path graph.db route:/courses/[lessonId] field:scienceLessons.id` → does the param reach this column?

### FR3: Route Discovery

First-class route nodes extracted from framework conventions.

**Framework patterns to detect:**
- **Next.js App Router**: files in `app/**/route.ts`/`page.tsx` with exported HTTP methods (`GET`, `POST`, etc.)
- **Hono**: `app.get('/path', handler)`, `app.post('/path', handler)`
- **tRPC**: `router.query('name', resolver)`, `router.mutation('name', resolver)`
- **Express-style**: `router.get('/path', handler)`

**Route node properties:**
- `type: "route"`
- `name: "/courses/[lessonId]/progress"` or `"courses.getById"`
- `method: "GET" | "POST" | "PUT" | "DELETE" | "QUERY" | "MUTATION"`
- `params: ["lessonId"]` (extracted from URL pattern or destructured params)
- `filePath`: source file

**Edges:**
- `contains` from file → route
- `param_flow` from route → param nodes
- `calls` / `depends_on` from route → downstream handlers / DB queries

**Query examples:**
- `build-graph search graph.db --type=route` → list all routes
- `build-graph deps graph.db "/courses/[lessonId]" --downstream` → all DB tables this route touches

## Non-Functional Requirements

- Maintain >90% test coverage for new scanner modules.
- Backward-compatible: existing DBs without `metadata` column work (fallback to empty).
- Scan time increase <20% for projects with <500 files.
- All new node/edge types documented in README.

## Acceptance Criteria

- [ ] `build-graph scan` stores string literals from `fetch()`, `eq()`, `router.push()` in edge metadata.
- [ ] `build-graph query` can search edge metadata for URL patterns or column references.
- [ ] `build-graph scan` creates `param_flow` edges from route params to their usage sites.
- [ ] `build-graph path` can trace from a route node to a DB column node via param_flow + calls edges.
- [ ] `build-graph scan` creates `route` nodes for Next.js, Hono, tRPC, and Express conventions.
- [ ] `build-graph search --type=route` returns only route nodes.
- [ ] Full test coverage for all three features with synthetic fixture projects.

## Out of Scope

- #4 `--call-path` specialization (combines FR1+FR3; can be added as a CLI convenience later)
- #6 `diff` mode against git (large feature, separate track)
- #7 Inverse `inspect` / impact analysis (can be done with existing `inspect` + new edges)
- #9 `.d.ts` → source resolution (tsconfig paths mapping is complex)
- #10 Auto-tags for framework idioms (can be added incrementally after routes exist)
