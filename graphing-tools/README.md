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

### Explore (agent graph query)

Single high-signal graph query for Measure agents. Returns matches, relationships, source snippets, and freshness metadata in one call:

```bash
bun run graphing-tools/build-graph-db.ts explore <db> "lesson route progress"
bun run graphing-tools/build-graph-db.ts explore <db> "useLesson" --json --include-source
```

Flags: `--json`, `--limit N`, `--depth N`, `--include-source`.

### Affected (changed-file impact)

Walk reverse dependency edges from changed files to surface downstream tests, routes, components, data-access, and other affected files:

```bash
# From arguments
bun run graphing-tools/build-graph-db.ts affected <db> src/auth.ts src/db/schema.ts

# From stdin (pipe-friendly)
git diff --name-only HEAD~1 HEAD | bun run graphing-tools/build-graph-db.ts affected <db> --stdin

# Tests only
bun run graphing-tools/build-graph-db.ts affected <db> src/auth.ts --tests-only --json
```

Flags: `--stdin`, `--json`, `--depth N`, `--tests-only`, `--filter <glob>`.

### Impact (symbol/file blast radius)

Show the bidirectional blast radius of a single node or file, surfacing routes, components, hooks, schemas, fields, and affected tests:

```bash
bun run graphing-tools/build-graph-db.ts impact <db> "schema:scienceLessons" --json
bun run graphing-tools/build-graph-db.ts impact <db> src/db/schema.ts --depth 3
```

Flags: `--json`, `--depth N`, `--edge-type T`, `--include-source`.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Not found (no matching nodes) |
| 2 | Ambiguous (multiple matches) |
| 3 | Misuse (missing arguments, unknown command) |
| 4 | Runtime error (file not found, parse error, SQLite failure) |

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
