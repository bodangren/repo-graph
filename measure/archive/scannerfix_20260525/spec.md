# Specification: Scanner Data-Quality Fixes

## Overview

The scanner enrichment track (`scanner_20260525`) added new node types (`schema`, `field`) and edge types (`renders`, `uses_hook`, `queries`, `mutates`, `has_field`, `references`). An audit of a real-world monorepo revealed that while the infrastructure works, the data quality of the new edges is poor. This track fixes 5 specific bugs to make the graph reliable for querying.

## Functional Requirements

### FR1: Resolve Dangling Wildcard Edges
- **Problem**: `renders` and `uses_hook` edges target wildcard IDs like `function:*:AppLayout`, but no corresponding nodes exist in the `nodes` table. JOIN queries return nothing; `inspect` shows 0 outgoing edges.
- **Solution**: After scanning, collect all wildcard target IDs and create placeholder `unresolved` nodes for them. These nodes participate in JOINs and are queryable.

### FR2: Extract defineTable Schemas Inside defineSchema
- **Problem**: `scanSchemas()` only iterates `VariableStatement`s. Convex schemas use `defineSchema({ users: defineTable({...}) })` where `defineTable` is nested inside a call-expression argument, not a variable declaration. Result: 0 schema/field nodes from `convex/schema.ts`.
- **Solution**: Recursively scan all `CallExpression` arguments for `defineTable` and `z.object` calls, not just top-level variable declarations.

### FR3: Generate queries/mutates Edges
- **Problem**: `SELECT DISTINCT type FROM edges` shows no `queries` or `mutates` edges despite `scanFrameworkEdges()` containing code for them.
- **Solution**: Fix `extractApiFunctionTarget()` and/or edge emission logic so `useQuery(api.mod.fn)` and `useMutation(api.mod.fn)` actually create edges.

### FR4: Cross-Package Import Resolution
- **Problem**: `deps graph.db AppRoutes --from-package=frontend --to-package=convex` returns nothing even though `App.tsx` imports Convex generated types. Raw SQL also finds no `imports` edges from frontend → convex.
- **Solution**: Ensure `import` edges are created for cross-package relative imports (e.g., `../../convex/_generated/api`). Verify `package_id` is correctly assigned to both source and target file nodes.

### FR5: Show Unresolved Edges in inspect
- **Problem**: `inspect` only counts resolvable edges (via JOIN). It silently hides `renders`/`uses_hook` relationships, making the user think they don't exist.
- **Solution**: Add an "Unresolved edges" section to `inspect` output listing edges whose targets are placeholder/unresolved nodes.

## Non-Functional Requirements

- Maintain >92% test coverage (current baseline).
- Backward-compatible with existing DBs (no schema migrations required; `package_id` already exists).
- Minimal performance regression on scan time.

## Acceptance Criteria

- [ ] `inspect` on a React component shows its `renders` and `uses_hook` edges with human-readable target names.
- [ ] `convex/schema.ts` containing `defineSchema({ ... defineTable({...}) })` produces `schema` and `field` nodes.
- [ ] `SELECT COUNT(*) FROM edges WHERE type = 'queries'` returns >0 after scanning a codebase with `useQuery(api.x.y)` calls.
- [ ] `deps` with `--from-package=A --to-package=B` finds cross-package import edges between monorepo packages.
- [ ] `inspect` output includes an "Unresolved edges" section when edges point to placeholder nodes.

## Out of Scope

- Resolving wildcard targets to actual file paths via import analysis (P2 enhancement, not this track).
- Support for non-Convex schema systems beyond `defineTable` and `z.object`.
- Rewriting the import resolution to use custom path mappings.
