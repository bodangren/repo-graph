# Spec: Remediate Code-Review Findings — Convenience Query Commands

## Overview

A code review of the `convenience_20260524` feature (commit `9779f1a`) confirmed 9 bugs across the
new CLI convenience subcommands (`deps`, `callers`, `path`, `stats`, `files`). Three are crashers,
three produce silently wrong results, and three are performance/UX defects. This track fixes all 9
in severity order.

---

## Functional Requirements

### F1 — Fix `deps --downstream` no-name crash · HIGH · `cli.ts:48`

Running `build-graph deps graph.db --downstream` (without a node name) passes `undefined` to
`resolveNode`. The length guard counts the flag token as a positional argument so the command
slips through; after filtering the flag, `filtered[2]` is `undefined`, and `name.toLowerCase()`
throws a TypeError.

**Fix:** After filtering flag tokens in the `deps` branch of `parseArgs`, assert that at least one
positional name remains. If not, throw the usage error as if too few args were supplied.

---

### F2 — Fix crash on pre-existing DBs missing `meta` table · HIGH · `meta.ts:8`

All five convenience commands call `getProjectRoot(db)` first. `getProjectRoot` issues
`SELECT value FROM meta WHERE key = ?`; on databases created before `meta` was added to
`schema.ts`, SQLite throws `SqliteError: no such table: meta`. None of the query handlers call
`createSchema` before executing.

**Fix:** Wrap the SQL in `getMeta` in a try/catch; on a "no such table" error return `undefined`.
Callers already treat `undefined` as "no root known" and fall back to absolute paths — no other
changes needed.

---

### F3 — Fix INSTR cycle-guard false positives in `runPath` CTE · HIGH · `commands.ts:155`

The recursive CTE uses `INSTR(p.path, e.target) = 0` to detect visited nodes. Because IDs are
concatenated with ` → ` and INSTR does a raw substring search, a shorter ID (e.g.
`function:/src/a.ts:get`) is falsely detected as visited when the path contains a longer ID of
which it is a strict prefix (`function:/src/a.ts:getter`). Valid shortest paths are silently
discarded.

**Fix:** Use a delimiter-bounded substring check that cannot match sub-IDs:

```sql
AND INSTR(' → ' || p.path || ' → ', ' → ' || e.target || ' → ') = 0
```

Prepending and appending the separator to the path string ensures every segment is bounded on both
sides, eliminating prefix and suffix false matches.

---

### F4 — Fix `runCallers` returning owning file as a caller · MEDIUM · `commands.ts:95`

The SQL filters by source node type (`function` or `file`) but not by edge type. The scanner emits
a `contains` edge from each file node to the functions it owns. This causes the owning `.ts` file
to appear in the callers output with `edge_type = contains`.

**Fix:** Restrict to actual call/import edges:

```sql
AND e.type IN ('calls', 'imports', 'depends_on')
```

---

### F5 — Fix `runPath` masking ambiguous-from when `to` is not found · MEDIUM · `commands.ts:119`

When `fromResolved.kind === "ambiguous"` and `toResolved.kind === "none"`, the first guard fires
(`|| toResolved.kind === "none"`) and returns `(no matches), exitCode: 0`, suppressing the
disambiguation error for `from`.

**Fix:** Check for ambiguous before checking for none:

```typescript
if (fromResolved.kind === "ambiguous") { … return { output: "", exitCode: 2 }; }
if (toResolved.kind === "ambiguous")   { … return { output: "", exitCode: 2 }; }
if (fromResolved.kind === "none" || toResolved.kind === "none") {
  return { output: "(no matches)", exitCode: 0 };
}
```

---

### F6 — Escape LIKE metacharacters in `resolveNode` partial search · MEDIUM · `resolve.ts:47`

The partial-name LIKE pattern is built as `` `%${name.toLowerCase()}%` `` with no escaping.
`%` and `_` in the user's input act as SQL wildcards. Searching for `parse_url` matches
`parseXurl`, `parseBurl`, etc., causing a spurious "ambiguous" result instead of resolving to
the single matching node.

**Fix:** Escape `%` → `\%` and `_` → `\_` before embedding in the pattern, and add `ESCAPE '\'`
to the LIKE clause:

```typescript
const escaped = name.toLowerCase().replace(/%/g, "\\%").replace(/_/g, "\\_");
const like = `%${escaped}%`;
// … WHERE LOWER(name) LIKE ? ESCAPE '\'
```

---

### F7 — Fix `--version` printing help instead of version string · LOW · `cli.ts:14`

`parseArgs` routes `--version`/`-v` to `{ subcommand: "help" }`, printing the full usage screen.
`VERSION = "0.1.0"` defined in `build-graph.ts` is never printed.

**Fix:** Route to a `"version"` subcommand in `parseArgs`; handle it in `main()` with
`console.log(VERSION); return ExitCode.Success`.

---

### F8+F9 — Replace dead query and N+1 loop in `runFiles` · LOW · `commands.ts:278,312`

`runFiles` first executes a full `GROUP BY file_path` aggregate query whose result (`rows`) is
immediately abandoned, then issues one additional `SELECT SUM(…)` per file in `.map()`, causing
an N+1 round-trip pattern. The two defects have the same root cause and the same fix.

**Fix:** Delete the dead `rows` query and replace the N+1 loop with a single query:

```sql
SELECT n.name, n.file_path,
       SUM(CASE WHEN n2.type = 'function'   THEN 1 ELSE 0 END) AS functions,
       SUM(CASE WHEN n2.type = 'class'      THEN 1 ELSE 0 END) AS classes,
       SUM(CASE WHEN n2.type = 'interface'  THEN 1 ELSE 0 END) AS interfaces,
       SUM(CASE WHEN n2.type = 'type_alias' THEN 1 ELSE 0 END) AS type_aliases
FROM nodes n
LEFT JOIN nodes n2 ON n2.file_path = n.file_path AND n2.type != 'file'
WHERE n.type = 'file'
[AND n.file_path LIKE ? ESCAPE '\']
GROUP BY n.file_path
ORDER BY n.file_path
```

---

## Non-Functional Requirements

- All 130 existing tests must continue to pass after every fix.
- New tests must cover each fix (one or more per finding).
- Code coverage must remain ≥ 80% after all changes.
- `runFiles` must issue exactly **one** SQL query to the database per invocation.

---

## Acceptance Criteria

- [ ] `build-graph deps graph.db --downstream` (no node name) prints the usage error and exits non-zero; it does not crash with TypeError.
- [ ] All five convenience commands (`deps`, `callers`, `path`, `stats`, `files`) work against databases that pre-date the `meta` table; relative-path output falls back to absolute paths without crashing.
- [ ] `build-graph path graph.db get getter` correctly returns a path when one exists and `get` is a prefix of an intermediate node ID.
- [ ] `build-graph callers myFunc` does not list the source file that owns `myFunc` in the callers table.
- [ ] `build-graph path graph.db ambiguousName missingNode` prints the disambiguation table for `ambiguousName` and exits 2 (not 0 with "(no matches)").
- [ ] `build-graph deps graph.db "parse_url"` resolves to the single node named `parse_url` rather than returning an ambiguous result.
- [ ] `build-graph --version` prints the version string (e.g. `0.1.0`) and exits 0; it does not print the help screen.
- [ ] `build-graph files graph.db` produces correct entity counts using a single SQL query.

---

## Out of Scope

- No new commands or features.
- No scanner changes.
- No changes to the edge-type taxonomy.
- No changes to `search.ts` LIKE patterns (separate concern).
- No schema migrations (the `meta` fix is handled at the query layer, not the schema layer).
