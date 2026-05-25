# Spec: LLM User Experience Improvements

## Overview

The primary consumer of `build-graph` is an LLM agent, not a human at a terminal. Current output
is optimised for human readability: ASCII bar charts, wide tables, and implicit conventions like
"(no matches)" on stdout with exit code 0. For an LLM these design choices are costly:

- ASCII tables are token-expensive and hard to parse programmatically.
- `(no matches)` exiting 0 is indistinguishable from a successful empty result — agents cannot
  branch without parsing text.
- Unbounded output on large codebases silently consumes context budget.
- Getting full context on a node always requires at least two round-trips (resolve → inspect).
- Multi-hop traversal requires a manual loop of single-hop queries.

This track makes `build-graph` a first-class LLM tool. All five improvements are additive and
backwards-compatible: existing flag-less invocations continue to behave identically.

---

## Functional Requirements

### L1 — `--json` flag on all query commands

Add `--json` / `-j` to: `deps`, `callers`, `path`, `stats`, `files`, `search`.

The flag already exists on `query`; this extends it uniformly.

**Output shapes (stdout):**

| Command | JSON shape |
|---------|-----------|
| `deps` | `{ "node": {…}, "results": [{type, name, file_path, edge_type}] }` |
| `callers` | `{ "node": {…}, "results": [{type, name, file_path, edge_type}] }` |
| `path` | `{ "found": true, "hops": N, "path": [{id, type, name}] }` or `{ "found": false }` |
| `stats` | `{ "totals": {…}, "by_type": […], "top_imported": […], "largest_files": […], "packages": {…} }` |
| `files` | `[{ "name": "…", "path": "…", "functions": N, "classes": N, "interfaces": N, "type_aliases": N }]` |
| `search` | `[{ "id": "…", "type": "…", "name": "…", "file_path": "…", "summary": "…" }]` |

Disambiguation tables (stderr) and progress output (stderr) are unaffected by `--json`.

---

### L2 — Machine-readable exit code taxonomy

Replace the current three-value exit code table with a five-value taxonomy that lets LLM scripts
branch without parsing stdout text.

| Code | Meaning | Currently |
|------|---------|-----------|
| `0` | Success — results found, or operation completed | 0 (also used for not-found) |
| `1` | Not found — query ran fine but matched no nodes | exits 0 with "(no matches)" text |
| `2` | Ambiguous — multiple nodes match; disambiguation on stderr | 2 (but conflicts with Misuse) |
| `3` | Misuse — bad arguments, wrong number of args | 2 (ExitCode.Misuse — conflicts with Ambiguous) |
| `4` | Runtime error — unhandled exception, DB error | 1 (ExitCode.RuntimeError) |

**Contract changes:**
- `ExitCode` in `contract.ts` gains `NotFound: 1`, `Ambiguous: 2` (explicit), `Misuse: 3`,
  `RuntimeError: 4`.
- `(no matches)` output changes to exit code 1 (instead of 0) across all commands.
- `build-graph.ts` top-level catch uses `ExitCode.RuntimeError` (4) and usage-error path uses
  `ExitCode.Misuse` (3).
- All `exitCode: 0 | 2` return types in `commands.ts` become `ExitCode.Success | ExitCode.Ambiguous`.

**Backwards-compatibility note:** Callers currently branching on exit 0/2 are unaffected for
success and ambiguous. The only breaking change is not-found (0 → 1) and runtime error (1 → 4);
document in README.

---

### L3 — `inspect` command

```
build-graph inspect <db> <node-id-or-name> [--json]
```

Returns everything known about a single node in one call: its metadata, all outgoing edges
(what it depends on / contains), and all incoming edges (what depends on it / calls it).

**Text output:**
```
function:parseConfig  (src/config/parser.ts:12–34)
Tags: async, public
Summary: Parses the raw config object and validates required fields.

Outgoing edges (4):
  imports   → file:src/config/schema.ts
  calls     → function:src/config/schema.ts:validateSchema
  depends_on → interface:src/config/types.ts:Config
  contains  ← (file owns this node)

Incoming edges (3):
  calls  ← function:src/server.ts:bootstrap
  calls  ← function:src/cli.ts:loadConfig
  tested_by ← function:src/config/parser.test.ts:testParseConfig
```

**JSON output** (with `--json`):
```json
{
  "node": { "id": "…", "type": "…", "name": "…", "file_path": "…",
            "line_start": 12, "line_end": 34, "summary": "…", "tags": […] },
  "outgoing": [{ "type": "imports", "target_id": "…", "target_name": "…", "target_type": "…" }],
  "incoming": [{ "type": "calls",   "source_id": "…", "source_name": "…", "source_type": "…" }]
}
```

Uses `resolveNode` for name resolution; returns ambiguous (exit 2) or not-found (exit 1) as
appropriate.

---

### L4 — `--limit N` on list commands

Add `--limit <N>` to: `deps`, `callers`, `files`, `search`.

When the result set exceeds N, truncate and append a footer line:
- Text: `… and 47 more (use --limit to raise cap, default 100)`
- JSON: add `"truncated": true, "total": 147` to the top-level response object.

Default limit: **100** (matches most codebases; prevents accidental context overflow).
Passing `--limit 0` means no limit (opt-out for power users / humans).

`path` and `stats` are naturally bounded and do not need `--limit`.

---

### L5 — `--depth N` on `deps` and `callers`

Add `--depth <N>` (default: 1, max: 10) to `deps` and `callers` for multi-hop traversal.

When `N > 1`, use a recursive CTE with the same boundary-safe INSTR guard introduced in the
`bugfix_20260525` track (F3). Results are annotated with their hop distance:

**Text:** additional `depth` column in the table.
**JSON:** each result object gains `"depth": N`.

At depth > 1, results include transitive nodes. Cycles are pruned. The `hops < N` guard caps
traversal. `--downstream` / no-flag direction applies at every hop.

---

## Non-Functional Requirements

- All existing tests pass with no flag additions (default behaviour is unchanged).
- New behaviour is only activated by the new flags / subcommand.
- `--json` output is always valid JSON (no partial writes, no mixed stdout).
- LLM-targeted output never mixes progress/warning messages with JSON (warnings go to stderr).
- Code coverage ≥ 80% for all changed modules.

---

## Acceptance Criteria

- [ ] `build-graph deps graph.db myFunc --json` emits valid JSON to stdout; exit 0.
- [ ] `build-graph deps graph.db missing --json` emits `{}` or `{"results":[]}` to stdout; exit **1**.
- [ ] `build-graph callers graph.db ambig --json` emits disambiguation table to **stderr**; exit **2**; stdout is empty.
- [ ] `build-graph path graph.db A B --json` emits `{"found":true,"hops":N,"path":[…]}` or `{"found":false}`; exit 0 or 1 respectively.
- [ ] `build-graph stats graph.db --json` emits a single JSON object (no ASCII art); exit 0.
- [ ] `build-graph files graph.db --json` emits a JSON array; exit 0.
- [ ] `build-graph search graph.db auth --json` emits a JSON array; exit 0.
- [ ] `build-graph inspect graph.db parseConfig` prints metadata + edges in text; exit 0.
- [ ] `build-graph inspect graph.db parseConfig --json` emits the full node profile as JSON; exit 0.
- [ ] `build-graph inspect graph.db missing` exits **1** with "(no matches)" message.
- [ ] `build-graph deps graph.db myFunc --limit 5` returns at most 5 rows plus a "… and N more" footer.
- [ ] `build-graph deps graph.db myFunc --depth 2` returns nodes up to 2 hops away, each annotated with depth.
- [ ] `build-graph callers graph.db myFunc --depth 3` returns transitive callers up to 3 hops.
- [ ] A script branching only on exit codes (0/1/2/3/4) correctly distinguishes all five cases without parsing stdout.
- [ ] `build-graph --version` exits **0** (not 3; it is not a misuse error). *(Depends on bugfix_20260525 F7.)*

---

## Out of Scope

- `--pick <index>` disambiguation shortcut (good idea, deferred).
- `show <file>` file-level inspection (covered partially by `inspect` + `files`).
- `orient` / `summary` orientation command (deferred).
- Changes to the scanner or schema.
- Pagination / cursor-based streaming for very large result sets.
