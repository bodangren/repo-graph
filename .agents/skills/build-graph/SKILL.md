---
name: build-graph
description: |
  Build and query a SQLite knowledge graph of a TypeScript codebase. Use this
  skill for structural code questions, callers, dependencies, paths, impact,
  architecture, and documentation-contract audits.
---

# build-graph

`repo-graph` is the canonical executable. It scans TypeScript through the
shared ts-morph AST pipeline and persists one deterministic SQLite graph.

## First-contact workflow

From the repository root:

```bash
test -f graph.db && test "$(find graph.db -mmin -1440 -print)" || repo-graph scan . ./graph.db
repo-graph stats ./graph.db
```

After a small structural edit, update the graph with the changed files:

```bash
repo-graph update ./graph.db src/file1.ts src/file2.ts
```

Use `repo-graph` before grep for structural questions:

```bash
repo-graph search ./graph.db foo
repo-graph callers ./graph.db foo
repo-graph deps ./graph.db module.ts --downstream
repo-graph path ./graph.db A.ts B.ts
repo-graph inspect ./graph.db SymbolName
```

For monorepos, the scanner discovers package `tsconfig.json` boundaries and
stores the owning package in `nodes.package_id`. Use `--from-package=P` and
`--to-package=P` on `deps` and `callers` when narrowing cross-package queries.

## Commands

```bash
repo-graph init <db>
repo-graph scan <project-dir> <db> [--config <path>] [--include <glob>]
repo-graph update <db> [<file> ...] [--json]
repo-graph query [--json] <db> <sql>
repo-graph search <db> <keyword> [--json] [--limit N] [--type=T]
repo-graph deps <db> <node> [--downstream] [--json] [--depth N]
repo-graph callers <db> <function> [--json] [--depth N]
repo-graph path <db> <from> <to> [--json]
repo-graph stats <db> [--json]
repo-graph files <db> [pattern] [--json] [--limit N]
repo-graph inspect <db> <node> [--json]
repo-graph explore <db> <query> [--json] [--limit N] [--depth N] [--include-source]
repo-graph affected <db> [file ...] [--stdin] [--json] [--depth N] [--tests-only]
repo-graph impact <db> <node-or-file> [--json] [--depth N] [--edge-type T]
repo-graph audit <db> [--json] [--docs] [--include-internal]
```

`--json` is the machine-readable form. Exit codes are 0 success, 1 not
found/issues, 2 ambiguous, 3 misuse, and 4 runtime failure.

`impact` uses a direction-preserving, cycle-safe BFS over persisted edges. A
file root remains a file root and expands to every explicitly contained
symbol; it never chooses one arbitrary child. Each relationship includes its
actual endpoints, traversal direction, depth, and persisted node path.
`affected` traverses only the declared impact edge types and returns only
graph-connected files classified by path-anchored test/route/component/data
access rules.

## Schema

```sql
nodes(
  id, type, name, file_path, line_start, line_end, summary,
  documentation, tags, complexity, language_notes, layer_id, package_id
)
edges(id, source, target, type, direction, weight, metadata)
files(path, content_hash, size, modified_at, indexed_at, node_count, errors)
layers(id, name, description, node_ids)
tour_steps(order_index, title, description, node_ids)
meta(key, value)
```

Node types include `file`, `function`, `class`, `interface`, `type_alias`,
`variable`, `schema`, `field`, `route`, and `param`. Edge types include
`contains`, `imports`, `extends`, `implements`, `calls`, `has_field`,
`references`, `renders`, `uses_hook`, `queries`, `mutates`, `param_flow`, and
`tested_by`.

`documentation` is versioned JSON with normalized description, parameter
descriptions, return description, supported tags, and declaration form. The
same payload is available from `inspect`, search JSON, and persisted scans.

## Freshness and audit

Freshness compares the recorded file size, mtime, and SHA-256 content hash to
live files. Touching, editing, moving, or deleting a file is reported as
stale/missing until a successful scan or update. Full and update mutations
refresh `files` and the FTS index atomically with graph rows.

Use the documentation audit for exported/public API contracts:

```bash
repo-graph audit ./graph.db --docs --json
repo-graph audit ./graph.db --docs --include-internal
```

Categories include missing JSDoc/description, missing or mismatched params,
missing returns, duplicate/extra tags, and unsupported declaration forms.
Constructors, `void`, and `Promise<void>` do not require `@returns`.

Expected external and unresolved call targets are represented explicitly and
excluded from broken-internal-edge findings. Duplicate checks are scoped by
declaration identity, so parameters with the same name in different
functions are not false positives.

## Maintenance contract

After changing signatures, imports, schemas, or JSX, refresh the graph:

```bash
repo-graph update ./graph.db path/to/changed.ts
```

## Continuous improvement

When using `repo-graph` reveals a utility or `build-graph` skill problem, or
an improvement worth requesting, summarize the observed behavior, expected
behavior, and a minimal reproduction, then create a GitHub issue with:

```bash
gh issue create --repo bodangren/repo-graph --title "..." --body "..."
```

The skill is named `build-graph`; all executable examples invoke the canonical
`repo-graph` binary. Never modify `measure/automation-supervisor.py`.
