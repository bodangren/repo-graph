# build-graph Feature Requests

Concrete asks ranked by how much they would have helped audit Track 3's Prisma→Drizzle migration, where the recurring bug was `eq(scienceLessons.id, lessonSlug)` — querying a UUID column with a slug-shaped URL param.

## 1. String-literal tracking on edges (biggest win)

Track string args to known sinks: `fetch('/api/...')`, `router.push('/...')`, SQL template tags, Drizzle `eq(table.col, value)`. Store the literal as edge metadata or a `string_ref` node type.

Then I could ask: *"Find all `fetch()` call sites whose URL matches `/api/.*lessons/.*`"* in one query instead of grepping. And: *"Find all `eq(scienceLessons.id, X)` calls and tell me which X values are URL params vs runtime UUIDs."*

This single feature would have collapsed today's 6 grep + 4 file-read round-trips into 2 queries.

## 2. JSX render edges for non-element-named components

Graph already has `renders` edges but missed `<AssignButton>`. Probably because the import name doesn't match a registered component pattern (or it skips PascalCase identifiers without a known schema). Make it greedy: any `<Identifier>` whose binding resolves to a function returning JSX is a render edge.

## 3. Param-flow / taint-style edges within a function

Edge type `param_flow` from a route handler's URL param to every DB query that uses it. So I could query: *"For route `…/[lessonId]/progress`, what columns does the `lessonId` URL param land in?"* and immediately see `scienceLessons.id` vs `scienceLessons.slug`.

This is the **structural** version of the bug-hunt. Hugely high-value for migrations.

## 4. `--call-path` between an HTTP route and a DB query

Like `path` but specialized: *"Show all DB columns reachable from URL param `lessonId` in route `X`."* Combines (1) + (3).

## 5. Route discovery

First-class concept of "route file" (`app/**/route.ts`, Hono `app.get('/...')`, tRPC procedures). One query: *"List all routes, their methods, their URL params, and the DB tables they touch."* Today I had to grep for `route.ts` + filter, then re-grep for table refs.

## 6. `diff` mode against git

`build-graph diff graph.db HEAD~5` → *"Which nodes/edges changed in the last 5 commits and what's the blast radius?"* For a Prisma→Drizzle migration where 200+ files moved, this is the missing safety net.

## 7. Inverse `inspect` — "What changes if I rename column X?"

`build-graph impact graph.db schema:scienceLessons.id` → list every `eq()`, `where()`, `set()`, join target that references it. Currently you can `inspect` a node but you don't get the call-site granularity needed for column-level reasoning.

## 8. Faster `search` with type filter

`search` matches name/summary; add `--type=schema --field=id` so I can find all field nodes called `id` belonging to schema `scienceLessons` directly.

## 9. Resolve `.d.ts` imports back to source

Currently imports point at `packages/db/dist/index.d.ts`. Resolve through tsconfig `paths` and `exports` to the real `packages/db/src/schema/lessons.ts`. Without this, schema-level cross-package queries (e.g. "who imports the lessons schema") are noisy.

## 10. Tags for framework idioms

Auto-tag nodes: `next-route`, `next-server-component`, `tRPC-procedure`, `drizzle-query`, `client-component`, `use-effect-fetch`. Then queries like *"all client components doing useEffect fetch to /api/students/..."* are trivial.

---

**Top 3 to ship first**: #1 (string literals), #3 (param flow), #5 (route discovery). Together they make migrations like Track 3 self-auditing — a query before the merge would have caught all 3 of today's bugs without a manual browser walkthrough.
