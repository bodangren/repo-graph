# Specification: Build graph.db builder with Bun and native SQLite

## Overview

Implement a Bun/TypeScript CLI tool that converts a `knowledge-graph.json` file into a queryable SQLite `graph.db` using Bun's built-in `bun:sqlite` driver.

## Inputs

- `knowledge-graph.json`: A JSON file containing:
  - `nodes`: Array of node objects (`id`, `type`, `name`, `filePath`, `summary`, `tags`, `complexity`, `languageNotes`)
  - `edges`: Array of edge objects (`source`, `target`, `type`, `direction`, `weight`)
  - `layers`: Array of layer objects (`id`, `name`, `description`, `nodeIds`)
  - `tour_steps`: Array of tour step objects (`orderIndex`, `title`, `description`, `nodeIds`)

## Outputs

- `graph.db`: A SQLite database file with the following schema:
  - `nodes(id, type, name, file_path, summary, tags, complexity, language_notes, layer_id)`
  - `edges(id, source, target, type, direction, weight)`
  - `layers(id, name, description, node_ids)`
  - `tour_steps(order_index, title, description, node_ids)`
  - Indexes on all foreign-key and query columns

## Acceptance Criteria

1. **CLI Interface**: `bun run graphing-tools/build-graph-db.ts <input.json> <output.db>`
2. **Schema Fidelity**: SQLite schema matches `measure/tech-stack.md` exactly
3. **Index Coverage**: All indexes from `measure/tech-stack.md` are created
4. **Data Integrity**: All nodes, edges, layers, and tour_steps are ingested without loss
5. **Layer Association**: `nodes.layer_id` is correctly populated by resolving `layers.node_ids`
6. **Error Handling**: Fail fast with verbose diagnostics for:
   - Missing or unreadable input file
   - Invalid JSON
   - Missing required fields
   - SQLite write errors
7. **Performance**: Use prepared statements and transactions for batch inserts
8. **Test Coverage**: >80% unit test coverage for all non-CLI modules

## Non-Functional Requirements

- **CLI-first**: No interactive prompts; all config via arguments
- **Machine-readable output**: Exit codes only (`0` success, `1` error, `2` misuse)
- **Internal tooling**: No public API, no auth, no config files
