# repo-graph

Knowledge graph builder for TypeScript codebases. Scans your project, extracts files, functions, classes, interfaces, and type aliases into a SQLite database, then lets you query relationships with SQL or convenience commands.

## Installation

```bash
bun run build
# Produces ./bin/build-graph — a standalone executable
cp ./bin/build-graph ~/.local/bin/
```

## Quick Start

```bash
# Scan a project
build-graph scan ./my-project graph.db

# Search for a node
build-graph search graph.db "auth"

# Run raw SQL
build-graph query graph.db "SELECT * FROM nodes WHERE type = 'class'"

# See stats
build-graph stats graph.db
```

## Commands

### Database Setup

| Command | Usage | Description |
|---------|-------|-------------|
| `init` | `build-graph init <db>` | Create a new graph database with schema and indexes |
| `scan` | `build-graph scan <project-dir> <db>` | Scan a TypeScript project and populate the database |
| `update` | `build-graph update <db> <file...>` | Incrementally update changed files |

### Querying

| Command | Usage | Description |
|---------|-------|-------------|
| `query` | `build-graph query [--json] <db> <sql>` | Execute raw SQL against the database |
| `search` | `build-graph search <db> <keyword> [--json] [--limit N]` | Fuzzy search nodes by name, summary, or tags |
| `deps` | `build-graph deps <db> <node> [--downstream] [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]` | Find who depends on a node (or who it depends on) |
| `callers` | `build-graph callers <db> <function> [--json] [--limit N] [--depth N] [--from-package=P] [--to-package=P]` | Find functions/files that reference a function |
| `path` | `build-graph path <db> <from> <to> [--json]` | Trace shortest dependency path between two nodes |
| `stats` | `build-graph stats <db> [--json]` | Print a codebase dashboard with totals, charts, and top lists |
| `files` | `build-graph files <db> [pattern] [--json] [--limit N]` | List files with entity counts, optionally filtered by pattern |
| `inspect` | `build-graph inspect <db> <node> [--json]` | Show full profile of a node (metadata + all edges) |

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

### Examples

```bash
# Who imports the User class?
build-graph deps graph.db User

# What does the auth module depend on?
build-graph deps graph.db auth.ts --downstream

# Who calls the validateToken function?
build-graph callers graph.db validateToken

# Trace a path from auth.ts to utils.ts
build-graph path graph.db auth.ts utils.ts

# Show a dashboard
build-graph stats graph.db

# List files matching "auth"
build-graph files graph.db auth
```

## Output

All commands print relative paths (e.g., `./src/auth.ts`) rather than absolute paths for readability.

## Schema

The SQLite database contains four tables:

- **`nodes`** — files, functions, classes, interfaces, type aliases, schemas, fields
- **`edges`** — relationships: `contains`, `imports`, `extends`, `implements`, `has_field`, `references`, `renders`, `uses_hook`, `queries`, `mutates`
- **`layers`** — logical groupings of nodes
- **`meta`** — key/value metadata including `project_root`

## Testing

```bash
bun test --coverage
```

## Development

```bash
bun run lint      # ESLint with boundary checks
bun run doctor    # Full project health check
bun run generate  # Regenerate generated docs
bun run build     # Compile standalone executable
```
