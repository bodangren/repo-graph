# Implementation Plan: Remediate Code-Review Findings — Convenience Query Commands

Bugs are addressed in severity order. Every task follows TDD: write the failing test first,
then fix the production code. Commit after each fix so changes are bisectable.

---

## Phase 1 — Contract & Schema Verification

No schema or contract changes are required. Confirm the relevant contracts are already correct
before writing tests.

- [x] Task: Verify contract invariants [2bd72ab]
    - [x] Confirm `schema.ts` already has `CREATE TABLE IF NOT EXISTS meta` (no migration needed)
    - [x] Confirm `contract.ts` `ExitCode` values cover all new failure paths (exit 2 for mis-use, exit 1 for runtime error)
    - [x] Confirm `ParsedArgs` type in `contract.ts` does not need a `"version"` subcommand entry (add if missing)
- [x] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Tests (Red Phase)

Write failing tests for all 9 findings before touching production code.
Run `bun test` after each task group to confirm the new tests fail.

- [x] Task: Test F1 — `deps --downstream` no-name guard (`cli.test.ts`)
    - [x] Add: `parseArgs(["deps", "graph.db", "--downstream"])` throws a usage error
    - [x] Run tests; confirm new test fails

- [x] Task: Test F2 — Graceful `meta` table fallback (`meta.test.ts`, `commands.test.ts`)
    - [x] Add in `meta.test.ts`: `getMeta` on a DB with no `meta` table returns `undefined` (not throws)
    - [x] Add in `commands.test.ts`: `runDeps` / `runStats` on a no-meta DB completes without throwing; output uses absolute paths

- [x] Task: Test F3 — INSTR cycle-guard prefix collision (`commands.test.ts`)
    - [x] Seed DB with nodes whose IDs share a prefix (e.g. `function:/a.ts:get` and `function:/a.ts:getter`)
    - [x] Add: `runPath(db, "get", "getter")` finds a path when one exists (currently returns "(no path found)")
    - [x] Run tests; confirm new test fails

- [x] Task: Test F4 — `runCallers` excludes `contains` edges (`commands.test.ts`)
    - [x] Seed DB with a function and its owning file connected by a `contains` edge
    - [x] Add: `runCallers` output does not include the owning file node
    - [x] Run tests; confirm new test fails

- [x] Task: Test F5 — `runPath` ambiguous-from + missing-to (`commands.test.ts`)
    - [x] Seed DB with two nodes named `parse` (ambiguous) and no node named `missingNode`
    - [x] Add: `runPath(db, "parse", "missingNode")` returns `exitCode: 2` and non-empty disambiguation output
    - [x] Run tests; confirm new test fails

- [x] Task: Test F6 — LIKE metachar escaping (`resolve.test.ts`)
    - [x] Seed DB with a single node named `parse_url`
    - [x] Add: `resolveNode(db, "parse_url")` returns `kind: "single"` (not ambiguous)
    - [x] Add: `resolveNode(db, "100%handler")` returns `kind: "single"` when exactly one node is named `100%handler`
    - [x] Run tests; confirm new tests fail

- [x] Task: Test F7 — `--version` subcommand (`cli.test.ts`)
    - [x] Add: `parseArgs(["--version"])` returns `{ subcommand: "version", args: {} }`
    - [x] Add: `parseArgs(["-v"])` returns `{ subcommand: "version", args: {} }`
    - [x] Run tests; confirm new tests fail

- [x] Task: Test F8+F9 — `runFiles` single-query correctness (`commands.test.ts`)
    - [x] Seed DB with two files, each owning a mix of functions, classes, and interfaces
    - [x] Add: `runFiles(db)` output contains correct entity counts for each file
    - [x] Verify test passes now (output is correct); the fix will change internal query count, not output
    - [x] Run tests; baseline established

- [x] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

Fix each bug. Run the full test suite after each fix. Commit individually.

- [ ] Task: Fix F1 — `deps --downstream` no-name guard (`cli.ts`)
    - [ ] In the `deps` branch of `parseArgs`, after filtering flag tokens, check `filtered.length < 3` and throw usage error if the name is absent
    - [ ] Run `bun test`; confirm F1 test passes and all others still pass
    - [ ] Commit: `fix(cli): Guard deps --downstream when node name is missing`

- [ ] Task: Fix F2 — Graceful `meta` table fallback (`meta.ts`)
    - [ ] Wrap the `db.prepare(…).get(key)` call in `getMeta` with try/catch; on `SqliteError` containing "no such table", return `undefined`
    - [ ] Run `bun test`; confirm F2 tests pass
    - [ ] Commit: `fix(meta): Return undefined gracefully when meta table is absent`

- [ ] Task: Fix F3 — INSTR cycle-guard boundary matching (`commands.ts`)
    - [ ] Replace `AND INSTR(p.path, e.target) = 0` with `AND INSTR(' → ' || p.path || ' → ', ' → ' || e.target || ' → ') = 0` in the `runPath` CTE
    - [ ] Run `bun test`; confirm F3 test passes
    - [ ] Commit: `fix(commands): Use delimiter-bounded INSTR in path CTE cycle guard`

- [ ] Task: Fix F4 — Exclude `contains` edges from `runCallers` (`commands.ts`)
    - [ ] Add `AND e.type IN ('calls', 'imports', 'depends_on')` to the `runCallers` query's WHERE clause
    - [ ] Run `bun test`; confirm F4 test passes
    - [ ] Commit: `fix(commands): Exclude contains edges from runCallers results`

- [ ] Task: Fix F5 — Ambiguous-before-none guard order in `runPath` (`commands.ts`)
    - [ ] Reorder the three resolution checks so both ambiguous checks precede the none check
    - [ ] Run `bun test`; confirm F5 test passes
    - [ ] Commit: `fix(commands): Check ambiguous resolution before none in runPath`

- [ ] Task: Fix F6 — Escape LIKE metacharacters in `resolveNode` (`resolve.ts`)
    - [ ] Before building the LIKE fragment, escape `%` → `\%` and `_` → `\_` in the lowercased name
    - [ ] Append `ESCAPE '\'` to the LIKE clause in the prepared statement
    - [ ] Apply the same escaping to the `runFiles` pattern parameter in `commands.ts:276`
    - [ ] Run `bun test`; confirm F6 tests pass
    - [ ] Commit: `fix(resolve): Escape SQL LIKE metacharacters in partial name search`

- [ ] Task: Fix F7 — `--version` prints version string (`cli.ts`, `build-graph.ts`)
    - [ ] In `parseArgs`, route `--version`/`-v` to `{ subcommand: "version", args: {} }`
    - [ ] Add `"version"` to the `Subcommand` union in `contract.ts` if needed
    - [ ] In `main()`, handle case `"version"`: `console.log(VERSION); return ExitCode.Success`
    - [ ] Run `bun test`; confirm F7 tests pass
    - [ ] Commit: `fix(cli): Print version string for --version / -v flag`

- [ ] Task: Fix F8+F9 — Single-query `runFiles` (`commands.ts`)
    - [ ] Delete the dead `rows` GROUP BY query (lines 278–297)
    - [ ] Replace the `fileRows` query + N+1 `.map()` loop with a single LEFT JOIN + GROUP BY query (see spec for SQL)
    - [ ] Return `formatTable` directly from the result of the new query
    - [ ] Run `bun test`; confirm all `runFiles` tests pass
    - [ ] Commit: `fix(commands): Replace dead query and N+1 loop in runFiles with single LEFT JOIN`

- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

---

## Phase 4 — Coverage, Generated Docs & Doctor

- [ ] Task: Verify coverage ≥ 80%
    - [ ] `bun test --coverage`
    - [ ] Review report; all modified modules (`cli.ts`, `meta.ts`, `commands.ts`, `resolve.ts`) must be at or above threshold

- [ ] Task: Run generate script and commit if changed
    - [ ] `./measure/generate.sh`
    - [ ] `git diff --exit-code measure/generated/` — commit any updated facts

- [ ] Task: Run doctor script
    - [ ] `./measure/doctor.sh`
    - [ ] Fix any architectural violations before finalising

- [ ] Task: Rebuild executable and install to `~/.local/bin/`
    - [ ] `bun run build` — produces `./bin/build-graph`
    - [ ] `cp ./bin/build-graph ~/.local/bin/build-graph`
    - [ ] `build-graph --version` — confirm version string prints correctly (end-to-end smoke test of F7)

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
