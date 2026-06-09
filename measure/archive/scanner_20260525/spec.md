# Spec: Scanner Enrichment — Runtime Schema & Framework-Aware Edge Extraction

## Overview

The current scanner extracts static declarations (functions, classes, interfaces, type aliases) and generic relationships (contains, imports, extends, implements, calls). This works well for plain TypeScript, but modern codebases are dominated by framework-specific patterns that are invisible to the graph:

- **Schema builders** like Convex `defineTable({ ... })`, Zod `z.object({ ... })`, and plain object literals used as configuration maps are treated as opaque function calls. Their fields, types, and relationships are lost.
- **Framework patterns** like React component rendering, hook usage, and data-fetching calls create implicit dependencies that are invisible to static analysis.

This track extends the scanner with two pluggable extractor passes that turn these runtime patterns into first-class graph nodes and edges.

---

## Functional Requirements

### S1 — Runtime Schema Extraction Pass

Add a `scanSchemas` pass that runs after the main AST scan and looks for object-literal patterns inside known schema builders.

**Detected patterns:**

| Builder | Pattern | Extracted |
|---------|---------|-----------|
| Convex | `defineTable({ name: v.string(), ... })` | Table node + field nodes with `has_field` edges |
| Zod | `z.object({ name: z.string(), ... })` | Schema node + field nodes with `has_field` edges |
| Plain object | `export const config = { apiUrl: "...", timeout: 30 }` | Config node + field nodes with `has_field` edges |

**Node format:**
- Schema/table node: `schema:<file_path>:<variable_name>` (type: `schema`)
- Field node: `field:<file_path>:<schema_name>.<field_name>` (type: `field`)

**Edges:**
- `file → schema` via `contains`
- `schema → field` via `has_field`
- Field type references (e.g. `v.id("users")`) → `field → schema:*/users` via `references` (if resolvable)

**Scope:** Only top-level variable declarations and exported consts are scanned. Nested inline objects are out of scope for this track.

---

### S2 — Framework-Aware Edge Extraction Pass

Add a `scanFrameworkEdges` pass that detects framework-specific call patterns and emits typed edges.

**React patterns:**

| Pattern | Source | Target | Edge |
|---------|--------|--------|------|
| `<Component />` in JSX | containing function/component | `Component` | `renders` |
| `useHook()` call | containing function/component | `useHook` | `uses_hook` |

**Convex patterns:**

| Pattern | Source | Target | Edge |
|---------|--------|--------|------|
| `useQuery(api.module.function)` | containing function | `function:*:module.function` | `queries` |
| `useMutation(api.module.function)` | containing function | `function:*:module.function` | `mutates` |

**Edge direction:** All edges are `forward` from caller/consumer to callee/provider.

---

### S3 — Cross-Boundary Package Labeling

Extend `scanProject` to label every node with its `package_id` derived from the nearest `tsconfig.json` boundary.

**Algorithm:**
1. During project creation, map each source file to its originating `tsconfig.json` path.
2. Derive a package ID: last directory segment of the tsconfig's parent (e.g. `convex`, `frontend`).
3. Store `package_id` in the `nodes.package_id` column.
4. If no tsconfig mapping exists, use `"root"`.

**Storage:**
- Add `package_id TEXT` to the `nodes` table schema.
- Add `package_id` to `GraphNode` interface in `contract.ts`.

---

### S4 — Package-Filtered Query Support

Extend `deps` and `callers` commands with an optional `--from-package` and `--to-package` filter.

**Behavior:**
- `--from-package=P` restricts results to nodes whose `package_id = P`.
- `--to-package=P` restricts results to nodes whose `package_id = P`.
- Both can be combined.
- The filter is applied at the SQL query layer (`JOIN nodes` + `WHERE package_id = ?`).

**CLI syntax:**
```
build-graph deps graph.db myFunc --from-package=frontend --to-package=convex
```

---

## Non-Functional Requirements

- Scanner must remain < 2× slower after adding both passes (measure with `time build-graph scan`).
- New edge types must be added to `EdgeType` union in `contract.ts`.
- All existing tests pass without modification.
- New tests must cover each pattern detection (≥ 80% coverage on new scanner modules).
- Schema changes are additive only (`ALTER TABLE` not required for fresh DBs; old DBs continue to work with NULL `package_id`).

---

## Acceptance Criteria

- [ ] Scanning a file with `const users = defineTable({ name: v.string(), projectId: v.id("projects") })` produces a `users` schema node, `users.name` and `users.projectId` field nodes, and a `references` edge from `users.projectId` to the `projects` schema.
- [ ] Scanning a React component that renders `<Child />` and calls `useAuth()` produces `renders` and `uses_hook` edges.
- [ ] Scanning a Convex frontend file that calls `useQuery(api.projects.getAll)` produces a `queries` edge.
- [ ] `build-graph deps graph.db myFunc --from-package=frontend` returns only frontend callers.
- [ ] `build-graph stats graph.db` shows a package breakdown in addition to the existing type breakdown.
- [ ] Existing 172 tests continue to pass.

---

## Out of Scope

- Prisma schema parsing (separate file format, not TypeScript AST).
- tRPC router parsing (deferred to a follow-up track).
- LLM summary backfill (requires external API, too complex for this track).
- Deep nested schema extraction (only top-level variable declarations).
- Automatic `tested_by` edge detection from test files.
