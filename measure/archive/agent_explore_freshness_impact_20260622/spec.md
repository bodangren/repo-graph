# Spec: Agent Explore, Freshness, and Changed-File Impact

## Overview

`repo-graph` is a personal, Measure-oriented graph tool for TypeScript projects, especially the user's Next.js and Vite project methodology. CodeGraph has significant overlap but is broader: multi-language parsing, MCP packaging, installers, and product distribution. This track deliberately pulls only the low-hanging fruit that improves Measure agents working in Next/Vite codebases:

1. A single high-signal `explore` command that returns graph context and source snippets in one call.
2. FTS5-backed search so graph lookup is fast and ranked without replacing the current schema.
3. File freshness metadata so Measure agents know when `graph.db` may be stale.
4. Changed-file `affected` and symbol/file `impact` commands for Measure acceptance, code review, and CI.

The goal is not to clone CodeGraph. The goal is to make `repo-graph` harder for agents to ignore during Measure phases and more useful for Next/Vite migration audits.

---

## Functional Requirements

### A1 — FTS5 Search Index

Add a SQLite FTS5 index for node search while keeping the current `nodes` table as the source of truth.

**Behavior:**
- Create `nodes_fts` over `id`, `name`, `file_path`, `summary`, and `tags`.
- Keep `nodes_fts` synchronized during full `scan`, incremental `update`, and any direct node insert/delete helpers.
- Update `search` to use FTS5 ranking when available, with a safe fallback to the existing `LIKE` query if FTS5 is unavailable in the local SQLite build.
- Preserve the current `build-graph search <db> <keyword> [--json] [--limit N] [--type=T]` interface.

### A2 — File Metadata and Freshness

Add first-class file metadata so query commands can warn when graph results may not reflect the working tree.

**Schema:**
- Add a `files` table with `path`, `content_hash`, `size`, `modified_at`, `indexed_at`, `node_count`, and `errors`.
- Add indexes for `files(path)` and `files(modified_at)`.

**Behavior:**
- Full `scan` records metadata for each scanned `.ts`/`.tsx` file and any `--include` files.
- Incremental `update` refreshes metadata for changed files.
- Deleted files are removed from `files`, `nodes`, and dependent edges during update/audit flows.
- Add reusable freshness helpers that compare current file size/mtime/hash against the stored record.
- `stats`, `inspect`, `explore`, `affected`, and `impact` include stale-file warnings when relevant.

### A3 — Agent Explore Command

Add a single command optimized for Measure agents:

```bash
build-graph explore <db> <query> [--json] [--limit N] [--depth N] [--include-source]
```

**Text output must include:**
- Best matching nodes ranked by FTS/name/file match.
- For each match: relative file path, line range, node type, tags, package, and summary when present.
- Relevant relationships: direct callers, callees, imports/dependents, render edges, route/schema/field edges, and param-flow edges when present.
- A compact source excerpt when `--include-source` is passed, bounded by a line budget and using stable line numbers.
- Freshness warning if any returned file is stale.
- A reminder that this output is sufficient context for the named files unless a stale warning says otherwise.

**JSON output must include:**
- `query`
- `matches`
- `relationships`
- `sourceSnippets`
- `freshness`
- `truncated`

### A4 — Changed-File Affected Command

Add a command that starts from changed files and returns likely downstream code and tests affected by those changes:

```bash
build-graph affected <db> [file...] [--stdin] [--json] [--depth N] [--tests-only] [--filter <glob>]
```

**Behavior:**
- Accept file paths as arguments or newline-delimited paths from stdin.
- Normalize paths relative to `project_root`.
- Walk reverse dependency edges from changed file nodes and contained symbol nodes.
- Include edge types relevant to Next/Vite Measure work: `imports`, `calls`, `references`, `renders`, `queries`, `mutates`, `param_flow`, `uses_hook`, `tested_by`, and custom edges.
- Identify test-like files by default patterns: `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, `__tests__/**`, `e2e/**`, `playwright/**`, and files matching `--filter`.
- Output affected files grouped as `tests`, `routes`, `components`, `dataAccess`, and `other`.
- Include the shortest graph path from each changed file to each affected file when `--json` is used.

### A5 — Symbol/File Impact Command

Add a command that starts from one symbol, file, route, schema, or field and reports blast radius:

```bash
build-graph impact <db> <node-or-file> [--json] [--depth N] [--edge-type T] [--include-source]
```

**Behavior:**
- Reuse existing node resolution and ambiguity behavior.
- Accept exact file paths in addition to node names/IDs.
- Walk both incoming and outgoing graph relationships with depth limits.
- Surface route handlers, rendered components, hooks, DB schemas/fields, and param-flow edges prominently.
- Include affected tests using the same classifier as `affected`.
- Include stale-file warnings for the root and affected files.

### A6 — Measure-Friendly Output Contract

The new commands must be pleasant for both humans and agents.

**Requirements:**
- Text output is compact, ordered by relevance/blast radius, and uses relative paths.
- JSON output is deterministic and suitable for Measure automation.
- Exit codes follow the existing taxonomy: success `0`, not found `1`, ambiguous `2`, misuse `3`, runtime error `4`.
- Large outputs are bounded with explicit `truncated` metadata and next-query guidance.

---

## Non-Functional Requirements

- Preserve Bun, `ts-morph`, and `bun:sqlite`; do not add Node-only runtime requirements.
- Do not introduce a daemon, MCP server, installer, telemetry, or multi-language parser in this track.
- Keep schema migrations backward-compatible for existing `graph.db` files by using additive tables/indexes and defensive creation.
- Keep full scans and incremental updates deterministic.
- Avoid broad CodeGraph-style framework coverage. Optimize for Next.js App Router, Next.js Pages Router, React/Vite, React Router, common hooks, Drizzle, and the existing route/schema/param-flow model.
- New query helpers must be covered by focused unit tests and integration tests on local fixtures.

---

## Acceptance Criteria

- [ ] `build-graph search` uses FTS5 ranking when available and keeps the existing text/JSON command contract.
- [ ] Full `scan` populates `files` metadata with hashes, mtimes, sizes, indexed timestamps, node counts, and errors.
- [ ] Incremental `update` refreshes affected `files` records and removes deleted-file graph data.
- [ ] `build-graph explore graph.db "lesson route progress" --json` returns matches, relationships, snippets, and freshness metadata.
- [ ] `build-graph affected graph.db --stdin --json` accepts changed files from stdin and returns grouped affected files plus tests.
- [ ] `build-graph impact graph.db scienceLessons.id --json` returns schema/field callers, route/param-flow paths, and affected tests when present.
- [ ] Stale files are detected and reported without blocking successful query output.
- [ ] Existing query commands continue to pass their current tests.
- [ ] `bun test` passes.
- [ ] `./measure/generate.sh` and `./measure/doctor.sh` pass or documented blockers are resolved before track closeout.

---

## Out of Scope

- Tree-sitter migration.
- Multi-language support beyond the existing TypeScript/TSX scanner and included file nodes.
- MCP server or agent installer work.
- Background file watcher or daemon.
- Telemetry or hosted product features.
- Graph visualization export.
- CI comment posting; this track only creates the `affected`/`impact` data that future CI work can consume.
