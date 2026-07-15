# repo-graph

Knowledge graph builder for TypeScript codebases. Scans your project, extracts files, functions, classes, interfaces, and type aliases into a SQLite database, then lets you query relationships with SQL or convenience commands.

## Installation

```bash
bun run build
# Produces ./bin/repo-graph — a standalone executable
cp ./bin/repo-graph ~/.local/bin/
```

## Quick Start

```bash
# Scan a project
repo-graph scan ./my-project graph.db

# Search for a node
repo-graph search graph.db "auth"

# Run raw SQL
repo-graph query graph.db "SELECT * FROM nodes WHERE type = 'class'"

# See stats
repo-graph stats graph.db
```

## Commands

### Database Setup

| Command | Usage | Description |
|---------|-------|-------------|
| `init` | `repo-graph init <db>` | Create a new graph database with schema and indexes |
| `scan` | `repo-graph scan <project-dir> <db>` | Scan a TypeScript project and populate the database |
| `update` | `repo-graph update <db> <file...>` | Incrementally update changed files |

### Querying

| Command | Usage | Description |
|---------|-------|-------------|
| `query` | `repo-graph query [--json] <db> <sql>` | Execute raw SQL against the database |
| `search` | `repo-graph search <db> <keyword> [--json] [--limit N] [--type=T]` | Fuzzy search nodes by name, summary, or tags |
| `deps` | `repo-graph deps <db> <node> [--downstream] [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]` | Find who depends on a node (or who it depends on) |
| `callers` | `repo-graph callers <db> <function> [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]` | Find functions/files that reference a function |
| `path` | `repo-graph path <db> <from> <to> [--json]` | Trace shortest dependency path between two nodes |
| `stats` | `repo-graph stats <db> [--json]` | Print a codebase dashboard with totals, charts, and top lists |
| `files` | `repo-graph files <db> [pattern] [--json] [--limit N]` | List files with entity counts, optionally filtered by pattern |
| `inspect` | `repo-graph inspect <db> <node> [--json]` | Show full profile of a node (metadata + all edges) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success — results found or operation completed |
| `1` | Not found — query ran but matched no nodes |
| `2` | Ambiguous — multiple nodes match; disambiguation on stderr |
| `3` | Misuse — bad arguments or unknown subcommand |
| `4` | Runtime error — unhandled exception or DB error |

### LLM / Scripting Flags

- `--json` / `-j` — Emit machine-readable JSON instead of ASCII tables
- `--limit N` / `-l N` — Cap result sets (default 100; 0 = unlimited)
- `--depth N` / `-d N` — Multi-hop traversal for `deps` and `callers` (default 1, max 10)
- `--from-package=P` — Restrict results to nodes from package `P`
- `--to-package=P` — Restrict results to nodes in package `P`
- `--type=T` — Restrict search to nodes of type `T` (e.g. `route`, `function`, `schema`)

### Examples

```bash
# Who imports the User class?
repo-graph deps graph.db User

# What does the auth module depend on?
repo-graph deps graph.db auth.ts --downstream

# Who calls the validateToken function?
repo-graph callers graph.db validateToken

# Trace a path from auth.ts to utils.ts
repo-graph path graph.db auth.ts utils.ts

# Show a dashboard
repo-graph stats graph.db

# List files matching "auth"
repo-graph files graph.db auth

# Search only route nodes
repo-graph search graph.db "/api" --type=route

# Find all fetch calls to /api/lessons
repo-graph query graph.db "SELECT * FROM edges WHERE metadata LIKE '%/api/lessons%'"
```

## Output

All commands print relative paths (e.g., `./src/auth.ts`) rather than absolute paths for readability.

## Schema

The SQLite database contains four tables:

- **`nodes`** — files, functions, classes, interfaces, type aliases, schemas, fields, routes, params, and structured JSDoc
- **`edges`** — relationships: `contains`, `imports`, `extends`, `implements`, `has_field`, `references`, `renders`, `uses_hook`, `queries`, `mutates`, `param_flow`, `calls`
- **`edge metadata`** — JSON blob storing string literals (URLs, column refs, query templates) captured at call sites
- **`layers`** — logical groupings of nodes
- **`meta`** — key/value metadata including `project_root`

## Testing

```bash
bun test --coverage
bun run typecheck
bun run typecheck:compat
```

## Development

```bash
bun run lint      # ESLint with boundary checks
bun run doctor    # Full project health check
bun run generate  # Regenerate generated docs
bun run build     # Compile ./bin/repo-graph
```
