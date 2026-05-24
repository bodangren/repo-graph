---
name: build-graph-db
description: |
  Build a SQLite graph database from a knowledge-graph JSON file. Use when the user wants to create a graph.db, convert knowledge-graph.json to SQLite, or build the Understand Anything graph database. Triggers on: "build graph db", "create graph.db", "convert knowledge graph", "graph database builder", or any task involving the build-graph-db executable.
---

# Build Graph DB

Convert a `knowledge-graph.json` file into a SQLite `graph.db` using the standalone `build-graph-db` executable.

## Quick Start

```bash
# Build the executable (from project root)
bun run build

# Run it
./bin/build-graph-db <input.json> <output.db>
```

Example:

```bash
./bin/build-graph-db .understand-anything/knowledge-graph.json .understand-anything/graph.db
```

## Building the Executable

The executable is compiled from `graphing-tools/build-graph-db.ts` using Bun's `--compile` flag:

```bash
bun build --compile ./graphing-tools/build-graph-db.ts --outfile ./bin/build-graph-db
```

This bundles all TypeScript modules (schema, indexes, ingest) into a single native binary with zero runtime dependencies.

## Input Format

`knowledge-graph.json` must be a JSON object with these top-level arrays:

- `nodes`: `{ id, type, name, filePath, summary, tags, complexity, languageNotes }`
- `edges`: `{ source, target, type, direction, weight }`
- `layers`: `{ id, name, description, nodeIds }`
- `tour_steps`: `{ orderIndex, title, description, nodeIds }`

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (file not found, invalid JSON, SQLite failure) |
| 2 | Misuse (missing arguments) |

## Schema

The output `graph.db` contains four tables:

```sql
nodes(id, type, name, file_path, summary, tags, complexity, language_notes, layer_id)
edges(id, source, target, type, direction, weight)
layers(id, name, description, node_ids)
tour_steps(order_index, title, description, node_ids)
```

Indexes are created on `nodes(type, name, file_path, layer_id)` and `edges(source, target, type)` for fast queries.

## Layer Resolution

After ingestion, `nodes.layer_id` is automatically populated by matching each node against `layers.node_ids` (JSON arrays) using SQLite's `json_each()`.

## Source Code

- Entry point: `graphing-tools/build-graph-db.ts`
- Schema: `graphing-tools/schema.ts`
- Indexes: `graphing-tools/indexes.ts`
- Ingestion: `graphing-tools/ingest.ts`
- Tests: `bun test` (run from project root)
