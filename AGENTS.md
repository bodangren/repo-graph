# Agent Guidelines for repo-graph

## Measure Workflow

Load the `measure` skill and read `measure/index.md` before starting work.

This project includes `build-graph` — a CLI tool that builds a SQLite knowledge graph of the TypeScript codebase. **Use it.** It is much faster and more accurate than grepping for structural questions.

## Documentation Standards

Use JSDoc for all exported functions. Describe params and returns without repeating TypeScript types.

## Workflow Rules

### 1. Build the graph on first contact

When you start working on this project, check if `graph.db` exists and is fresh (modified within the last 24 hours). If not, build it:

```bash

# If graph.db is missing or stale
build-graph scan . ./graph.db

# If graph.db exists and you only edited a few files
build-graph update ./graph.db src/file1.ts src/file2.ts
```

### 2. Query before you grep

For structural questions, **always query the graph first** instead of grepping:

| Instead of... | Query the graph |
|---------------|-----------------|
| `grep -r "function foo"` | `build-graph search ./graph.db foo` |
| "What uses this function?" | `build-graph callers ./graph.db foo` |
| "What does this module import?" | `build-graph deps ./graph.db module.ts --downstream` |
| "How are these files connected?" | `build-graph path ./graph.db A.ts B.ts` |

### 3. Inspect before editing exported symbols

Before modifying any **exported** function, class, interface, or schema, check its relationships to understand blast radius:

```bash

# See all callers and dependencies
build-graph inspect ./graph.db SymbolName

# Or just callers
build-graph callers ./graph.db SymbolName

# Or just dependencies
build-graph deps ./graph.db SymbolName
```

> **Why:** This catches cross-file and cross-package dependencies that grep misses.

### 4. Use package filters in monorepos

This repo may contain multiple packages (e.g. `frontend/`, `convex/`). When querying, narrow scope with package filters:

```bash

# Only show frontend callers
build-graph callers ./graph.db myHook --from-package=frontend

# Only show convex dependencies
build-graph deps ./graph.db myFunc --to-package=convex

# Cross-boundary analysis
build-graph deps ./graph.db myFunc --from-package=frontend --to-package=convex
```

### 5. Update the graph after structural edits

After you finish a batch of edits that change:
- Function/class signatures
- Export/import relationships
- Schema definitions (`defineTable`, `z.object`)
- Component hierarchies (JSX)

Update the graph so the next agent (or your next session) has accurate context:

```bash

# After editing files
build-graph update ./graph.db src/auth.ts src/schema.ts

# Or re-scan if you changed many files across packages
build-graph scan . ./graph.db
```

> **When NOT to update:** Purely internal changes inside a single function body (no signature changes, no new imports/exports, no JSX changes).

## Schema Reference

```sql
-- Key tables
nodes(id, type, name, file_path, line_start, line_end, summary, tags, package_id)
edges(id, source, target, type, direction, weight)
meta(key, value)   -- includes project_root
```

**Node types:** `file`, `function`, `class`, `interface`, `type_alias`, `schema`, `field`

**Edge types:** `contains`, `imports`, `extends`, `implements`, `calls`, `depends_on`, `has_field`, `references`, `renders`, `uses_hook`, `queries`, `mutates`

## Common Queries

```sql
-- Find schema tables and their fields
SELECT s.name AS table_name, f.name AS field_name
FROM nodes s
JOIN edges e ON e.source = s.id AND e.type = 'has_field'
JOIN nodes f ON f.id = e.target
WHERE s.type = 'schema';

-- Find React components and what they render
SELECT src.name AS component, tgt.name AS child
FROM edges e
JOIN nodes src ON src.id = e.source
JOIN nodes tgt ON tgt.id = e.target
WHERE e.type = 'renders';

-- Find all Convex API calls from frontend
SELECT n.name AS caller, e.type, e.target AS api
FROM edges e
JOIN nodes n ON n.id = e.source
WHERE e.type IN ('queries', 'mutates') AND n.package_id = 'frontend';
```

## Automation Supervisor

Do NOT modify measure/automation-supervisor.py. This file is centrally managed and hardlinked across all projects.
