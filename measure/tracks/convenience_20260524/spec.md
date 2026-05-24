# Specification: Convenience Query Commands for build-graph

## Overview

Add developer-friendly subcommands to `build-graph` that wrap common SQL query patterns. The current tool requires writing raw SQL for everyday tasks like "who imports this?" or "what's in this file?" This track adds convenience commands with clean output, making the tool productive for day-to-day development.

## Functional Requirements

### Command: `deps`

```
build-graph deps <db> <node-name-or-id>
```

Find all nodes that import/contain/extend/implement the target node (upstream dependents).

- Accept either a node name (e.g., `CircuitBreaker`) or partial node ID
- If multiple nodes match the name, show a disambiguation list and exit with code 2
- Output: table with `type`, `name`, `file_path` (relative to project root), `edge_type`
- Default to `--upstream` (who depends on me); support `--downstream` (who do I depend on)

### Command: `callers`

```
build-graph callers <db> <function-name>
```

Shorthand for `deps` filtered to `type = 'function'` edges. Shows which functions/files reference the target function.

### Command: `path`

```
build-graph path <db> <from> <to>
```

Trace a dependency path from one node to another using SQL CTEs.

- If no path exists, print `(no path found)` and exit 0
- If multiple paths exist, show the shortest (by hop count)
- Output: chain like `file:A.ts → function:B → file:C.ts` with edge types

### Command: `stats`

```
build-graph stats <db>
```

Print a summary dashboard of the codebase:

- Total nodes, edges, files
- Nodes by type (bar chart via ASCII)
- Top 10 most imported nodes
- Top 10 largest files by entity count
- Package breakdown (entities per top-level directory)

### Command: `files`

```
build-graph files <db> [pattern]
```

List files in the graph. With no pattern, list all. With pattern, filter by path substring.

- Output: `name | path | functions | classes | interfaces`
- Sorted by path

### Relative Paths

All output should use paths relative to the project root (stored in `graph.db` or inferred from the scan directory). Absolute paths are noise.

**Storage:** Add a `meta` table to `graph.db`:
```sql
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
-- store: project_root -> /home/daniel-bo/Desktop/fleet-commander
```

Set during `scan` and `init`. Use it to strip the prefix from all output.

## Non-Functional Requirements

- **Performance:** All convenience queries must complete in <100ms on a 2,000-node database
- **Output format:** Consistent table output matching existing `query`/`search` commands
- **Exit codes:** 0 = success, 1 = runtime error, 2 = ambiguous input (multiple matches)
- **No breaking changes:** Existing `scan`, `query`, `search`, `update`, `init` commands unchanged

## Acceptance Criteria

- [ ] `build-graph deps graph.db CircuitBreaker` shows all files that import it
- [ ] `build-graph callers graph.db configure` shows all functions that reference it
- [ ] `build-graph path graph.db bootstrap configure` traces a path between nodes
- [ ] `build-graph stats graph.db` prints a summary dashboard
- [ ] `build-graph files graph.db orchestrator` lists files matching the pattern
- [ ] All commands show relative paths, not absolute
- [ ] Ambiguous names print disambiguation list and exit 2
- [ ] Each convenience command has unit tests
- [ ] All existing tests still pass
- [ ] Coverage remains >80%
- [ ] ESLint and doctor pass

## Out of Scope

- Call-expression tracing inside function bodies (still not supported)
- Interactive/TUI mode
- Real-time file watching
- Integration with IDE extensions
- Export to formats other than table/JSON
