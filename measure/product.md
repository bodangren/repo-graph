# Knowledge Graph Query Layer

## Problem

AI agents working on large TypeScript codebases — legacy monorepos, enterprise applications, long-lived projects — have no persistent map of the code. Every task starts from zero context. Agents resort to `grep` for discovery, which is:

- **Slow** — O(n) scan across thousands of files for every query
- **Shallow** — finds string matches, not semantic relationships (who calls whom, inheritance chains, layer boundaries)
- **Ephemeral** — no memory between tasks; the agent re-discovers the same structure repeatedly
- **Fragile** — renamed symbols, dynamic imports, and workspace aliases break string matching

Example failures:
- "Find all functions that call the auth hook" requires parsing import chains across packages
- "Trace data flow from API handler → service → DB" needs multi-hop traversal
- "What breaks if I rename this interface?" requires transitive dependency analysis

## Solution

A **standalone CLI tool** that programmatically scans TypeScript codebases, extracts structural knowledge via AST parsing, and stores it in a queryable SQLite database. The database becomes the agent's persistent memory of the codebase.

### How it works

1. **Scan**: `repo-graph scan <dir> <db>` parses all `.ts`/`.tsx` files using `ts-morph`, extracts nodes (files, functions, classes, interfaces) and edges (imports, calls, contains, extends, implements).

2. **Query**: Agents write SQL against a documented schema — indexed lookups, joins, recursive CTEs for path tracing. The CLI also exposes `explore`, `affected`, and `impact` for Measure agents working in Next.js/Vite codebases.

3. **Update**: Git hooks run `repo-graph update <db> <changed-files>` to incrementally re-parse only touched files, keeping the graph fresh.

### Architecture

```
TypeScript source files
        ↓
   ts-morph (AST parsing)
        ↓
    nodes, edges, layers
        ↓
    bun:sqlite (graph.db)
        ↓
   SQL queries (agent tools)
```

### Benefits

- **Indexed random access** — O(log n) lookups vs O(n) grep scan
- **Multi-hop queries** — SQL CTEs traverse A → B → C dependency chains
- **Persistent memory** — graph.db survives across agent sessions
- **Incremental updates** — git hooks keep the graph in sync, no full rebuilds
- **Zero LLM for structure** — AST extraction is deterministic, fast, and free
- **Single runtime** — Bun + ts-morph + bun:sqlite, no Python, no Node.js, no external services

### What lives where

| Artifact | Purpose |
|----------|---------|
| `graph.db` | Queryable knowledge graph (SQLite) |
| `graphing-tools/` | Source code: scanner, schema, query patterns |
| `graphing-tools/legacy/` | Old Node.js/Python scripts (to be replaced) |
