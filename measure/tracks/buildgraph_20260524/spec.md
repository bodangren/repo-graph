# Specification: Build the `build-graph` CLI Tool

## Overview

Create a standalone, compiled CLI executable (`build-graph`) that programmatically scans TypeScript codebases via `ts-morph`, extracts structural entities (files, functions, classes, interfaces, imports), and stores them in an indexed SQLite database (`graph.db`). The tool provides subcommands for full scans, incremental updates, SQL queries, and fuzzy search.

This replaces the incorrect `graphdb_20260524` track, which built a JSON-to-SQLite converter instead of a source-code scanner.

## Functional Requirements

### Command: `scan`

```
build-graph scan <project-dir> <output.db>
```

- Discover `.ts` and `.tsx` files via `tsconfig.json` (`include`/`files`) or recursive glob fallback.
- Parse each file with `ts-morph`.
- Extract nodes:
  - **file** — one per source file
  - **function** — function declarations, arrow functions, method declarations
  - **class** — class declarations
  - **interface** — interface declarations
  - **type_alias** — type alias declarations
- Extract edges:
  - **contains** — file contains function/class/interface/type_alias
  - **imports** — file imports from another file (resolved relative path)
  - **extends** — class extends another class
  - **implements** — class implements an interface
- Store all nodes and edges in `graph.db` with the schema defined in `tech-stack.md`.
- Populate `nodes.layer_id` via import-pattern clustering (v1: simple heuristic based on directory structure).
- Run inside a SQLite transaction for atomicity.
- Print progress to stderr (file count, node count, edge count, elapsed time).

### Command: `update`

```
build-graph update <db> <file1> <file2> ...
```

- For each changed file:
  1. `DELETE FROM nodes WHERE file_path = ?`
  2. `DELETE FROM edges WHERE source LIKE 'file:<path>%' OR target LIKE 'file:<path>%'`
  3. Re-parse the file and re-insert nodes/edges.
- Run inside a SQLite transaction.
- Print affected node/edge counts.

### Command: `query`

```
build-graph query <db> "<sql>"
```

- Execute the provided SQL against `graph.db`.
- Print results as a formatted table (stdout).
- Exit 1 if SQL is invalid or the query fails.

### Command: `search`

```
build-graph search <db> <keyword>
```

- Run a fuzzy search across `nodes.name`, `nodes.summary`, and `nodes.tags`.
- Use `LIKE '%keyword%'` with case-insensitive matching (`LOWER()`).
- Return top 20 matches as a formatted table.
- Columns: `type`, `name`, `file_path`, `summary`.

### Command: `init`

```
build-graph init <db>
```

- Create `graph.db` with the full schema and indexes.
- Idempotent (`CREATE TABLE IF NOT EXISTS`).

## Non-Functional Requirements

- **Single tsconfig.json**: v1 only supports one `tsconfig.json` per scan. Monorepo multi-config discovery is out of scope.
- **TypeScript only**: `.ts` and `.tsx` files only. JavaScript without types is out of scope.
- **No LLM calls**: All extraction is deterministic AST parsing. Summaries come from JSDoc comments only.
- **Performance target**: Scan 1,000 files in <10 seconds on a modern laptop.
- **Compiled executable**: Distributed via `bun build --compile`. Single binary, zero runtime dependencies.
- **Exit codes**: 0 (success), 1 (runtime error), 2 (misuse / bad args).

## Acceptance Criteria

- [ ] `build-graph scan ./ ./graph.db` produces a valid `graph.db` with nodes and edges from the current repo.
- [ ] `build-graph init ./graph.db` creates schema and indexes without errors.
- [ ] `build-graph query ./graph.db "SELECT COUNT(*) FROM nodes"` returns the correct count.
- [ ] `build-graph search ./graph.db "schema"` returns nodes matching the keyword.
- [ ] `build-graph update ./graph.db src/schema.ts` re-parses only that file and updates the graph.
- [ ] `bun run build` produces `./bin/build-graph` executable.
- [ ] The executable runs without Bun installed.
- [ ] All subcommands have unit tests.
- [ ] Code coverage >80%.
- [ ] ESLint and `./measure/doctor.sh` pass.

## Out of Scope

- Monorepo workspace discovery (multiple `tsconfig.json` files)
- JavaScript files without TypeScript
- Cross-language analysis (Python, Go, Rust, etc.)
- LLM-generated summaries or semantic analysis
- Call-expression tracing (who calls whom inside function bodies)
- Real-time file watching / hot reload
- Dashboard or visualization UI
- Git hook automation (documented but not installed by the tool)
