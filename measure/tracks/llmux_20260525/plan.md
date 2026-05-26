# Implementation Plan: LLM User Experience Improvements

Features are implemented in priority order: exit codes first (L2) because they affect every
command's return contract, then JSON output (L1), then inspect (L3), then limit (L4), then
depth (L5). Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Schema

Update `contract.ts` to define the new exit code taxonomy and extend arg interfaces before
writing any tests or implementation code.

- [x] Task: Expand `ExitCode` in `contract.ts`
    - [x] Add `NotFound: 1`, keep `Ambiguous: 2` (explicit), change `Misuse: 3`, change `RuntimeError: 4`
    - [x] Update `ExitCodeValue` type to include all five values
    - [x] Note: this is a non-breaking contract change — no runtime call sites yet

- [x] Task: Extend arg interfaces for new flags
    - [x] Add `json?: boolean` to `DepsArgs`, `CallersArgs`, `PathArgs`, `StatsArgs`, `FilesArgs`, `SearchArgs`
    - [x] Add `limit?: number` to `DepsArgs`, `CallersArgs`, `FilesArgs`, `SearchArgs`
    - [x] Add `depth?: number` to `DepsArgs`, `CallersArgs`
    - [x] Add `"inspect"` to `Subcommand` union; add `InspectArgs { dbPath: string; name: string; json?: boolean }`
    - [x] Add `"version"` to `Subcommand` union (coordinate with bugfix_20260525 F7 if already done)
    - [x] Add `InspectArgs` variant to `ParsedArgs` union

- [x] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Tests (Red Phase)

Write all failing tests before touching implementation. Group by feature.
Run `bun test` after each task to confirm new tests fail.

- [x] Task: Tests L2 — Exit code taxonomy (`cli.test.ts`, `commands.test.ts`)
    - [x] Add: commands returning not-found produce `exitCode: ExitCode.NotFound` (1)
    - [x] Add: `build-graph.ts` top-level catch uses `ExitCode.RuntimeError` (4) not 1
    - [x] Add: usage error path uses `ExitCode.Misuse` (3) not 2
    - [x] Add: ambiguous path produces `exitCode: ExitCode.Ambiguous` (2) — should pass already

- [x] Task: Tests L1a — `--json` on `deps` and `callers` (`commands.test.ts`)
    - [ ] Add: `runDeps(db, name, downstream, { json: true })` returns a valid JSON string
    - [ ] Add: JSON output contains `"node"` and `"results"` fields
    - [ ] Add: JSON not-found returns `{ "results": [] }` not "(no matches)" string
    - [ ] Add: `runCallers(db, name, { json: true })` mirrors the same shape

- [x] Task: Tests L1b — `--json` on `path` (`commands.test.ts`)
    - [ ] Add: `runPath` with `json: true` and a valid path returns `{ found: true, hops: N, path: [{…}] }`
    - [ ] Add: `runPath` with `json: true` and no path returns `{ found: false }`

- [x] Task: Tests L1c — `--json` on `stats` and `files` (`commands.test.ts`)
    - [ ] Add: `runStats(db, { json: true })` returns a parseable JSON object (not ASCII art)
    - [ ] Add: `runFiles(db, undefined, { json: true })` returns a JSON array

- [x] Task: Tests L1d — `--json` on `search` (`commands.test.ts` or `search.test.ts`)
    - [ ] Add: search with `json: true` returns a JSON array of result objects

- [x] Task: Tests L3 — `inspect` command (`commands.test.ts`)
    - [ ] Add: `runInspect(db, name)` on an existing node returns text with outgoing and incoming edges
    - [ ] Add: `runInspect(db, name, { json: true })` returns JSON with `node`, `outgoing`, `incoming`
    - [ ] Add: `runInspect(db, "missing")` returns `exitCode: ExitCode.NotFound`
    - [ ] Add: `runInspect(db, "ambig")` returns `exitCode: ExitCode.Ambiguous`

- [x] Task: Tests L4 — `--limit N` (`commands.test.ts`)
    - [ ] Add: `runDeps` with `limit: 2` on a node with 5 deps returns 2 results + truncation footer
    - [ ] Add: `runDeps` with `limit: 2, json: true` returns `{ "results": […2 items…], "truncated": true, "total": 5 }`
    - [ ] Add: `runDeps` with `limit: 0` returns all results

- [x] Task: Tests L5 — `--depth N` (`commands.test.ts`)
    - [ ] Seed DB with a 3-hop chain: A → B → C → D
    - [ ] Add: `runDeps(db, "A", false, { depth: 1 })` returns only B
    - [ ] Add: `runDeps(db, "A", false, { depth: 3 })` returns B (depth 1), C (depth 2), D (depth 3)
    - [ ] Add: `runDeps` with cycles in the graph does not loop infinitely
    - [ ] Add: `runCallers` with `depth: 2` returns transitive callers

- [x] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

- [x] Task: Implement L2 — Exit code taxonomy (`commands.ts`, `build-graph.ts`, `cli.ts`)
    - [ ] Replace all `exitCode: 0` not-found returns in `commands.ts` with `ExitCode.NotFound`
    - [ ] Replace `exitCode: 2` ambiguous returns with `ExitCode.Ambiguous`
    - [ ] Update top-level catch in `build-graph.ts`: usage errors → `ExitCode.Misuse` (3), others → `ExitCode.RuntimeError` (4)
    - [ ] Update all `{ exitCode: 0 | 2 }` TypeScript return types to `ExitCode.Success | ExitCode.NotFound | ExitCode.Ambiguous`
    - [ ] Run `bun test`; confirm L2 tests pass
    - [ ] Commit: `feat(contract): Implement five-value exit code taxonomy for LLM script branching`

- [x] Task: Implement L1 — `--json` flag on all query commands
    - [ ] `cli.ts`: parse `--json` / `-j` for `deps`, `callers`, `path`, `stats`, `files`, `search`
    - [ ] `commands.ts`: add optional `opts?: { json?: boolean }` parameter to `runDeps`, `runCallers`, `runPath`, `runStats`, `runFiles`
    - [ ] For each command: when `json: true`, return `JSON.stringify(…)` with the shape specified in the spec; skip ASCII table formatting
    - [ ] `build-graph.ts`: thread the `json` flag from parsed args through to each handler
    - [ ] `search.ts` (or `build-graph.ts` `handleSearch`): add JSON output path for search results
    - [ ] Run `bun test`; confirm all L1 tests pass
    - [ ] Commit: `feat(commands): Add --json flag to deps, callers, path, stats, files, search`

- [x] Task: Implement L3 — `inspect` command (`commands.ts`, `cli.ts`, `build-graph.ts`)
    - [ ] `commands.ts`: implement `runInspect(db, name, opts?)` — resolve node, query all outgoing and incoming edges with joined node names, format as text table or JSON
    - [ ] `cli.ts`: add `inspect` branch to `parseArgs` — `build-graph inspect <db> <name> [--json]`
    - [ ] `build-graph.ts`: add `handleInspect` and wire into `main()` switch
    - [ ] `build-graph.ts`: add `inspect` to `printHelp`
    - [ ] Run `bun test`; confirm L3 tests pass
    - [ ] Commit: `feat(commands): Add inspect command for full single-node profile`

- [x] Task: Implement L4 — `--limit N` (`commands.ts`, `cli.ts`)
    - [ ] `cli.ts`: parse `--limit <N>` for `deps`, `callers`, `files`, `search`; default 100; `--limit 0` → no cap
    - [ ] `commands.ts`: apply LIMIT to SQL queries; when total > limit, compute full count and append footer
    - [ ] JSON mode: add `"truncated": true, "total": N` when results are capped
    - [ ] Run `bun test`; confirm L4 tests pass
    - [ ] Commit: `feat(commands): Add --limit flag to prevent unbounded context consumption`

- [x] Task: Implement L5 — `--depth N` on `deps` and `callers` (`commands.ts`, `cli.ts`)
    - [ ] `cli.ts`: parse `--depth <N>` (integer 1–10) for `deps` and `callers`
    - [ ] `commands.ts` `runDeps`: when `depth > 1`, replace direct edge query with a recursive CTE using the boundary-safe INSTR guard (from bugfix_20260525 F3); annotate each result row with `depth` value
    - [ ] `commands.ts` `runCallers`: mirror the same recursive CTE for incoming edges
    - [ ] Text output: add `depth` column to the result table
    - [ ] JSON output: add `"depth": N` to each result object
    - [ ] Run `bun test`; confirm L5 tests pass
    - [ ] Commit: `feat(commands): Add --depth flag for multi-hop traversal on deps and callers`

- [x] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

---

## Phase 4 — Coverage, Generated Docs, Doctor & Install

- [x] Task: Verify coverage ≥ 80%
    - [ ] `bun test --coverage`
    - [ ] All modified modules (`commands.ts`, `cli.ts`, `contract.ts`, `build-graph.ts`) at or above threshold

- [x] Task: Update README with new flags and exit code table
    - [ ] Document `--json`, `--limit`, `--depth` in the Commands table
    - [ ] Add "Exit Codes" section with the five-value taxonomy
    - [ ] Add `inspect` command to the Querying table

- [x] Task: Run generate script and commit if changed
    - [ ] `./measure/generate.sh`
    - [ ] `git diff --exit-code measure/generated/` — commit any updated facts

- [x] Task: Run doctor script
    - [ ] `./measure/doctor.sh`
    - [ ] Fix any architectural violations before finalising

- [x] Task: Rebuild executable and install to `~/.local/bin/`
    - [ ] `bun run build`
    - [ ] `cp ./bin/build-graph ~/.local/bin/build-graph`
    - [ ] Smoke test: `build-graph inspect ~/.local/bin/build-graph` *(should produce an error or empty, not crash)*
    - [ ] Smoke test: `build-graph stats graph.db --json | head -5` (confirm valid JSON)

- [x] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
