# graphing-tools

Standalone knowledge graph builder for TypeScript codebases.

Scans `.ts`/`.tsx` files via `ts-morph`, extracts structural entities (files, functions, classes, interfaces, imports), and stores them in an indexed SQLite database. Agents query `graph.db` with SQL for fast dependency analysis and code navigation.

## Installation

```bash
bun install
```

## Commands

### Scan a codebase

Full scan from a project directory:

```bash
bun run graphing-tools/build-graph-db.ts scan <project-dir> <output.db>
```

Example:

```bash
bun run graphing-tools/build-graph-db.ts scan ./ ./graph.db
```

### Update incrementally

Re-parse only changed files (for git hooks):

```bash
bun run graphing-tools/build-graph-db.ts update <db> <file1> <file2> ...
```

Example:

```bash
bun run graphing-tools/build-graph-db.ts update ./graph.db src/auth.ts src/utils.ts
```

### Query the database

Run SQL directly:

```bash
sqlite3 graph.db "SELECT id, name, type FROM nodes WHERE name LIKE '%auth%'"
```

Or use the built-in query command:

```bash
bun run graphing-tools/build-graph-db.ts query <db> "<sql>"
```

### Search nodes

Fuzzy search across names and summaries:

```bash
bun run graphing-tools/build-graph-db.ts search <db> <keyword>
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (file not found, parse error, SQLite failure) |
| 2 | Misuse (missing arguments, unknown command) |

## Schema

```sql
nodes(id, type, name, file_path, line_start, line_end, summary, tags, complexity, language_notes, layer_id)
edges(id, source, target, type, direction, weight)
layers(id, name, description, node_ids)
tour_steps(order_index, title, description, node_ids)
```

Indexes on `nodes(type, name, file_path, layer_id)` and `edges(source, target, type)`.

## Input

The scanner reads TypeScript source files directly. No JSON input required. It discovers files via:

1. `tsconfig.json` `include` / `files` (if present)
2. Recursive glob of `.ts`, `.tsx` files (fallback)

## Tests

```bash
bun test
```

## Git Hook

Add to `.git/hooks/post-commit` for incremental updates:

```bash
CHANGED=$(git diff --name-only --diff-filter=ACM HEAD~1 HEAD -- '*.ts' '*.tsx')
if [ -n "$CHANGED" ]; then
  bun run graphing-tools/build-graph-db.ts update ./graph.db $CHANGED
fi
```
