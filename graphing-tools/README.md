# graphing-tools

SQLite companion database builder for the Understand Anything knowledge graph.

Converts `knowledge-graph.json` → `graph.db` using Bun's native SQLite driver.

## Usage

```bash
bun run graphing-tools/build-graph-db.ts <input.json> <output.db>
```

Example:

```bash
bun run graphing-tools/build-graph-db.ts \
  .understand-anything/knowledge-graph.json \
  .understand-anything/graph.db
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Runtime error (file not found, invalid JSON, SQLite failure) |
| 2 | Misuse (missing arguments) |

## Input Format

`knowledge-graph.json` must be a JSON object with:

- `nodes`: Array of `{ id, type, name, filePath, summary, tags, complexity, languageNotes }`
- `edges`: Array of `{ source, target, type, direction, weight }`
- `layers`: Array of `{ id, name, description, nodeIds }`
- `tour_steps`: Array of `{ orderIndex, title, description, nodeIds }`

## Schema

```sql
nodes(id, type, name, file_path, summary, tags, complexity, language_notes, layer_id)
edges(id, source, target, type, direction, weight)
layers(id, name, description, node_ids)
tour_steps(order_index, title, description, node_ids)
```

Indexes: `idx_nodes_type`, `idx_nodes_name`, `idx_nodes_file_path`, `idx_nodes_layer_id`, `idx_edges_source`, `idx_edges_target`, `idx_edges_type`.

## Tests

```bash
bun test
```
