# Implementation Plan: Scanner Extensibility — Config-Driven Edge Types, Route Mode Tags, and Custom File Patterns

Features are implemented in dependency order: config parsing first, then route mode extraction, then custom file patterns. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Schema

Update `contract.ts` and `build-graph.ts` to support the new config loading, `--include` flag, and route mode tag storage before writing any tests or implementation.

- [ ] Task: Extend `ScanArgs` in `contract.ts`
    - [ ] Add `configPath?: string` to `ScanArgs`
    - [ ] Add `includePatterns?: string[]` to `ScanArgs`

- [ ] Task: Add config types to `contract.ts`
    - [ ] Add `BuildGraphConfig` interface
    - [ ] Add `CustomEdgeDef` interface
    - [ ] Do NOT add custom edge types to the `EdgeType` union — they are runtime-only strings

- [ ] Task: Update CLI parsing in `cli.ts`
    - [ ] Parse `--config <path>` flag in scan subcommand
    - [ ] Parse `--include <glob>` flag (repeatable) in scan subcommand
    - [ ] Thread both through to `ScanArgs`

- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Tests (Red Phase)

Write all failing tests before touching scanner implementation.

- [ ] Task: Tests FR-1 — Config loading and custom edge creation (`config.test.ts`)
    - [ ] Add: `loadConfig` returns parsed config from valid JSON file
    - [ ] Add: `loadConfig` returns `null` when file does not exist (no error)
    - [ ] Add: `loadConfig` throws on malformed JSON with descriptive error
    - [ ] Add: `loadConfig` warns and skips entries with missing `type` field
    - [ ] Add: `loadConfig` warns and skips entries with invalid `sourceType`
    - [ ] Add: Custom edges from config appear in scan output with correct type name
    - [ ] Add: `--config` flag overrides auto-discovery path

- [ ] Task: Tests FR-2 — Route mode tag extraction (`scanner.test.ts`)
    - [ ] Add: `scanRoutes` extracts `export const mode = 'practice'` and adds `"mode:practice"` to route tags
    - [ ] Add: `scanRoutes` handles `export const mode = 'teaching'` (recognized value)
    - [ ] Add: `scanRoutes` handles `export const mode = 'custom_value'` (unrecognized but stored)
    - [ ] Add: `scanRoutes` ignores non-string-literal mode exports (e.g., `export const mode = someVar`)
    - [ ] Add: `scanRoutes` does not add mode tag when file has no `mode` export
    - [ ] Add: Route node tags include both param tags and mode tags (no clobbering)

- [ ] Task: Tests FR-3 — Custom glob patterns (`scanner.test.ts` or `build-graph.test.ts`)
    - [ ] Add: `--include "data/**/*.json"` produces file nodes for matching JSON files
    - [ ] Add: Multiple `--include` patterns are additive
    - [ ] Add: `--include` does NOT parse non-TS files for functions/classes (file-level only)
    - [ ] Add: Files in `SKIP_DIRS` are excluded even if glob matches
    - [ ] Add: Glob matching zero files emits warning to stderr, does not halt

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

- [ ] Task: Implement FR-1 — Config loading and custom edge injection
    - [ ] Create `config.ts` with `loadConfig(projectDir: string, configPath?: string): BuildGraphConfig | null`
    - [ ] Validate config structure; warn on invalid entries, skip them
    - [ ] In `build-graph.ts` `handleScan`: call `loadConfig` after `createProject`
    - [ ] After `scanProject`, apply custom edges: for each `CustomEdgeDef`, find matching source/target nodes and emit edges
    - [ ] Pass `--config` from `ScanArgs` to `loadConfig`
    - [ ] Run `bun test`; confirm FR-1 tests pass
    - [ ] Commit: `feat(config): Load custom edge types from build-graph.config.json`

- [ ] Task: Implement FR-2 — Route mode tag extraction
    - [ ] In `scanner.ts` `scanRoutes`: after creating a route node, scan the same source file for `export const mode = '<string>'`
    - [ ] Use ts-morph to find `VariableDeclaration` named `mode` that is exported
    - [ ] Extract the initializer if it's a `StringLiteral`; add `"mode:<value>"` to the route node's tags
    - [ ] Merge mode tags with existing param tags (append, don't replace)
    - [ ] Run `bun test`; confirm FR-2 tests pass
    - [ ] Commit: `feat(scanner): Extract route mode exports as node tags`

- [ ] Task: Implement FR-3 — Custom glob patterns via `--include`
    - [ ] In `build-graph.ts` `handleScan`: accept `includePatterns` from `ScanArgs`
    - [ ] Use `glob` (Bun built-in or `fs` + `fast-glob`) to resolve patterns relative to project root
    - [ ] Filter out matches inside `SKIP_DIRS`
    - [ ] For each matched file: create a `file` node (type: `file`, no child nodes)
    - [ ] Deduplicate against TS files already scanned (skip if `file:<path>` already exists)
    - [ ] Emit warning to stderr if a pattern matches zero files
    - [ ] Run `bun test`; confirm FR-3 tests pass
    - [ ] Commit: `feat(scan): Support --include flag for custom file glob patterns`

- [ ] Task: Measure - User Manual Verification 'Phase 3' (Protocol in workflow.md)

---

## Phase 4 — Coverage, Generated Docs, Doctor & Install

- [ ] Task: Verify coverage ≥ 80%
    - [ ] `bun test --coverage`
    - [ ] All modified modules at or above threshold

- [ ] Task: Run generate script and commit if changed
    - [ ] `./measure/generate.sh`
    - [ ] `git diff --exit-code measure/generated/`

- [ ] Task: Run doctor script
    - [ ] `./measure/doctor.sh`
    - [ ] Fix any architectural violations

- [ ] Task: Rebuild executable and install to `~/.local/bin/`
    - [ ] `bun run build`
    - [ ] `cp ./bin/build-graph ~/.local/bin/build-graph`
    - [ ] Smoke test: scan with config file, verify custom edges in output

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
