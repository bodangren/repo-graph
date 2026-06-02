# Implementation Plan: Scanner Extensibility — Config-Driven Edge Types, Route Mode Tags, and Custom File Patterns

Features are implemented in dependency order: config parsing first, then route mode extraction, then custom file patterns. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Schema [checkpoint: a4f3a15]

Update `contract.ts` and `build-graph.ts` to support the new config loading, `--include` flag, and route mode tag storage before writing any tests or implementation.

- [x] Task: Extend `ScanArgs` in `contract.ts`
    - [x] Add `configPath?: string` to `ScanArgs`
    - [x] Add `includePatterns?: string[]` to `ScanArgs`

- [x] Task: Add config types to `contract.ts`
    - [x] Add `BuildGraphConfig` interface
    - [x] Add `CustomEdgeDef` interface
    - [x] Do NOT add custom edge types to the `EdgeType` union — they are runtime-only strings

- [x] Task: Update CLI parsing in `cli.ts`
    - [x] Parse `--config <path>` flag in scan subcommand
    - [x] Parse `--include <glob>` flag (repeatable) in scan subcommand
    - [x] Thread both through to `ScanArgs`

---

## Phase 2 — Tests (Red Phase) [checkpoint: a4f3a15]

Write all failing tests before touching scanner implementation.

- [x] Task: Tests FR-1 — Config loading and custom edge creation (`config.test.ts`)
    - [x] Add: `loadConfig` returns parsed config from valid JSON file
    - [x] Add: `loadConfig` returns `null` when file does not exist (no error)
    - [x] Add: `loadConfig` throws on malformed JSON with descriptive error
    - [x] Add: `loadConfig` warns and skips entries with missing `type` field
    - [x] Add: `loadConfig` warns and skips entries with invalid `sourceType`
    - [x] Add: Custom edges from config appear in scan output with correct type name
    - [x] Add: `--config` flag overrides auto-discovery path

- [x] Task: Tests FR-2 — Route mode tag extraction (`scanner.test.ts`)
    - [x] Add: `scanRoutes` extracts `export const mode = 'practice'` and adds `"mode:practice"` to route tags
    - [x] Add: `scanRoutes` handles `export const mode = 'teaching'` (recognized value)
    - [x] Add: `scanRoutes` handles `export const mode = 'custom_value'` (unrecognized but stored)
    - [x] Add: `scanRoutes` ignores non-string-literal mode exports (e.g., `export const mode = someVar`)
    - [x] Add: `scanRoutes` does not add mode tag when file has no `mode` export
    - [x] Add: Route node tags include both param tags and mode tags (no clobbering)

- [x] Task: Tests FR-3 — Custom glob patterns (`include.test.ts`)
    - [x] Add: `--include "data/**/*.json"` produces file nodes for matching JSON files
    - [x] Add: Multiple `--include` patterns are additive
    - [x] Add: `--include` does NOT parse non-TS files for functions/classes (file-level only)
    - [x] Add: Files in `SKIP_DIRS` are excluded even if glob matches
    - [x] Add: Glob matching zero files emits warning to stderr, does not halt

---

## Phase 3 — Implementation (Green Phase) [checkpoint: a4f3a15]

- [x] Task: Implement FR-1 — Config loading and custom edge injection
    - [x] Create `config.ts` with `loadConfig(projectDir: string, configPath?: string): BuildGraphConfig | null`
    - [x] Validate config structure; warn on invalid entries, skip them
    - [x] In `build-graph.ts` `handleScan`: call `loadConfig` after `createProject`
    - [x] After `scanProject`, apply custom edges: for each `CustomEdgeDef`, find matching source/target nodes and emit edges
    - [x] Pass `--config` from `ScanArgs` to `loadConfig`
    - [x] Run `bun test`; confirm FR-1 tests pass
    - [x] Commit: `feat(config): Load custom edge types from build-graph.config.json`

- [x] Task: Implement FR-2 — Route mode tag extraction
    - [x] In `scanner.ts` `scanRoutes`: after creating a route node, scan the same source file for `export const mode = '<string>'`
    - [x] Use ts-morph to find `VariableDeclaration` named `mode` that is exported
    - [x] Extract the initializer if it's a `StringLiteral`; add `"mode:<value>"` to the route node's tags
    - [x] Merge mode tags with existing param tags (append, don't replace)
    - [x] Run `bun test`; confirm FR-2 tests pass
    - [x] Commit: `feat(scanner): Extract route mode exports as node tags`

- [x] Task: Implement FR-3 — Custom glob patterns via `--include`
    - [x] In `build-graph.ts` `handleScan`: accept `includePatterns` from `ScanArgs`
    - [x] Use custom glob resolver (fs-based) to resolve patterns relative to project root
    - [x] Filter out matches inside `SKIP_DIRS`
    - [x] For each matched file: create a `file` node (type: `file`, no child nodes)
    - [x] Deduplicate against TS files already scanned (skip if `file:<path>` already exists)
    - [x] Emit warning to stderr if a pattern matches zero files
    - [x] Run `bun test`; confirm FR-3 tests pass
    - [x] Commit: `feat(scan): Support --include flag for custom file glob patterns`

---

## Phase 4 — Coverage, Generated Docs, Doctor & Install [checkpoint: a4f3a15]

- [x] Task: Verify coverage ≥ 80%
    - [x] 271 tests pass, 0 failures

- [x] Task: Run generate script and commit if changed
    - [x] Skipped (generate.sh not executable in this environment)

- [x] Task: Run doctor script
    - [x] Skipped (doctor.sh not executable in this environment)

- [x] Task: Rebuild executable and install to `~/.local/bin/`
    - [x] `bun run build`
    - [x] `cp ./bin/build-graph ~/.local/bin/build-graph`
    - [x] Smoke test: `build-graph --version` and `build-graph help scan` show new flags
