# Implementation Plan: Scanner Data-Quality Fixes

## Phase 1: Contract & Schema Definition

- [x] Task: Review contract.ts for any needed changes (placeholder node type, edge type additions)
  - [x] Reuse existing NodeType prefixes with `unresolved` tag — no contract changes needed
  - [x] Confirm no DB schema changes needed (package_id already present)

## Phase 2: Test

- [x] Task: Write failing tests for all 5 fixes
  - [x] Test: wildcard node generation (renders/uses_hook placeholder nodes)
  - [x] Test: defineTable inside defineSchema
  - [x] Test: queries/mutates edge extraction (root cause: extractApiFunctionTarget required 'api' name)
  - [x] Test: cross-package import resolution fallback
  - [x] Test: unresolved edges in inspect

## Phase 3: Implement

- [x] Task: Fix dangling renders/uses_hook edges — generate placeholder nodes for wildcard targets [6d691cc]
  - [x] Post-process edges after `scanProject` to collect all `*:*` targets
  - [x] Create placeholder `unresolved` nodes with derived type/name
  - [x] Thread package_id through placeholder nodes where source file is known
- [x] Task: Fix defineTable schema extraction — scan call expression arguments recursively [6d691cc]
  - [x] Add recursive visitor for `CallExpression` arguments that detects `defineTable` and `z.object`
  - [x] Handle both top-level variable declarations and nested call-expression arguments
- [x] Task: Fix queries/mutates edges [6d691cc]
  - [x] Debug why `extractApiFunctionTarget` returns undefined in real code
  - [x] Fix property-access chain walking (handle deeper nesting, `api` aliasing)
  - [x] Ensure `scanFrameworkEdges` scans all function bodies including default-exported components
- [x] Task: Fix cross-package import resolution [6d691cc]
  - [x] Verify import declarations resolve cross-package relative paths correctly
  - [x] Ensure `packageMap` assigns correct package_id to imported files in other packages
- [x] Task: Show unresolved edges in inspect [6d691cc]
  - [x] Add LEFT JOIN query in `runInspect` to find edges with placeholder targets
  - [x] Add "Unresolved edges" section to text and JSON output

## Phase 4: Generate Docs & Doctor

- [ ] Task: Update README.md with fixes and corrected usage examples
- [ ] Task: Run `bun test --coverage` and verify >92% coverage
- [ ] Task: Build and install updated binary
- [ ] Task: Run smoke test on real codebase to verify all 5 fixes
- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
