# Implementation Plan: Scanner Data-Quality Fixes

## Phase 1: Contract & Schema Definition

- [ ] Task: Review contract.ts for any needed changes (placeholder node type, edge type additions)
  - [ ] Verify `unresolved` node type or decide to reuse existing types with a `placeholder` tag
  - [ ] Confirm no DB schema changes needed (package_id already present)

## Phase 2: Test

- [ ] Task: Write failing tests for wildcard node generation
  - [ ] Test: `scanFrameworkEdges` on a component that renders `<OtherComponent />` produces a `function:*:OtherComponent` placeholder node
  - [ ] Test: `scanFrameworkEdges` on a hook call `useCustomHook()` produces a `function:*:useCustomHook` placeholder node
- [ ] Task: Write failing tests for defineTable inside defineSchema
  - [ ] Test: `scanSchemas` finds `defineTable({...})` nested inside `defineSchema({ users: defineTable({...}) })`
  - [ ] Test: Fields inside nested defineTable are extracted as `field` nodes
- [ ] Task: Write failing tests for queries/mutates edge extraction
  - [ ] Test: `useQuery(api.users.get)` inside a function body creates a `queries` edge
  - [ ] Test: `useMutation(api.users.create)` creates a `mutates` edge
- [ ] Task: Write failing tests for cross-package import edges
  - [ ] Test: Relative import `../../other-pkg/file.ts` between packages creates an `imports` edge with correct package_ids on both file nodes
- [ ] Task: Write failing tests for unresolved edges in inspect
  - [ ] Test: `runInspect` on a node with outgoing edges to placeholder nodes shows an "Unresolved edges" section

## Phase 3: Implement

- [ ] Task: Fix dangling renders/uses_hook edges — generate placeholder nodes for wildcard targets
  - [ ] Post-process edges after `scanProject` to collect all `*:*` targets
  - [ ] Create placeholder `unresolved` nodes with derived type/name
  - [ ] Thread package_id through placeholder nodes where source file is known
- [ ] Task: Fix defineTable schema extraction — scan call expression arguments recursively
  - [ ] Add recursive visitor for `CallExpression` arguments that detects `defineTable` and `z.object`
  - [ ] Handle both top-level variable declarations and nested call-expression arguments
- [ ] Task: Fix queries/mutates edges
  - [ ] Debug why `extractApiFunctionTarget` returns undefined in real code
  - [ ] Fix property-access chain walking (handle deeper nesting, `api` aliasing)
  - [ ] Ensure `scanFrameworkEdges` scans all function bodies including default-exported components
- [ ] Task: Fix cross-package import resolution
  - [ ] Verify import declarations resolve cross-package relative paths correctly
  - [ ] Ensure `packageMap` assigns correct package_id to imported files in other packages
- [ ] Task: Show unresolved edges in inspect
  - [ ] Add LEFT JOIN query in `runInspect` to find edges with placeholder targets
  - [ ] Add "Unresolved edges" section to text and JSON output

## Phase 4: Generate Docs & Doctor

- [ ] Task: Update README.md with fixes and corrected usage examples
- [ ] Task: Run `bun test --coverage` and verify >92% coverage
- [ ] Task: Build and install updated binary
- [ ] Task: Run smoke test on real codebase to verify all 5 fixes
- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
