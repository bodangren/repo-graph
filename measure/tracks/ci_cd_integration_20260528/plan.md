# Implementation Plan: CI/CD Integration — GitHub Action

Features are implemented in dependency order: diff command first, then GitHub Action, then workflow template and docs. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Diff Schema

Update `contract.ts` to support graph diffing before writing any tests or implementation.

- [ ] Task: Add diff result types to contract
    - [ ] Add `GraphDiff` interface with `addedNodes`, `removedNodes`, `modifiedNodes`, `addedEdges`, `removedEdges`
    - [ ] Add `AffectedEntryPoint` interface with `nodeId` and `transitiveChangedDeps`
    - [ ] Add `DiffOptions` interface with `criticalNodes` and `outputFormat`

- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Tests (Red Phase)

Write all failing tests before touching diff or action implementation.

- [ ] Task: Tests C2 — Diff command (`diff.test.ts`)
    - [ ] Add: `diff` detects nodes present in base but missing in PR as removed
    - [ ] Add: `diff` detects nodes present in PR but missing in base as added
    - [ ] Add: `diff` detects edges present in base but missing in PR as removed
    - [ ] Add: `diff` detects edges present in PR but missing in base as added
    - [ ] Add: `diff` identifies affected entry points (top-level exports with transitive changes)
    - [ ] Add: `diff` outputs structured JSON when `--format json` is passed
    - [ ] Add: `diff` outputs Markdown when `--format markdown` is passed
    - [ ] Add: `diff` with `--critical-nodes` flags affected critical nodes

- [ ] Task: Tests C4 — Action inputs and outputs (`action.test.ts` or shell tests)
    - [ ] Add: Action parses inputs correctly
    - [ ] Add: Action sets outputs `nodes-changed`, `edges-changed`, `impact-report`
    - [ ] Add: Action fails workflow when `fail-on-impact` is true and critical nodes are affected

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

- [ ] Task: Implement C2 — Diff command
    - [ ] Create `diff.ts` with `runDiff(baseDb, prDb, options)` function
    - [ ] Implement node set comparison (added, removed, modified)
    - [ ] Implement edge set comparison (added, removed)
    - [ ] Implement affected entry point detection via reverse transitive closure
    - [ ] Implement `--format json` and `--format markdown` output
    - [ ] Implement `--critical-nodes` flag for configurable critical path checks
    - [ ] Integrate into CLI as `repo-graph diff <base.db> <pr.db> [options]`
    - [ ] Run `bun test`; confirm C2 tests pass
    - [ ] Commit: `feat(diff): Add graph diff command for PR impact analysis`

- [ ] Task: Implement C1 — GitHub Action
    - [ ] Create `.github/actions/repo-graph-action/action.yml`
    - [ ] Define inputs: `db-path`, `tsconfig-path`, `comment-on-pr`, `fail-on-impact`
    - [ ] Define outputs: `nodes-changed`, `edges-changed`, `impact-report`
    - [ ] Create `entrypoint.ts` that runs the action logic
    - [ ] Implement base branch graph.db checkout or cache restore
    - [ ] Implement PR scan and diff generation
    - [ ] Implement PR comment posting (create or update existing)
    - [ ] Implement `fail-on-impact` workflow failure
    - [ ] Run action tests; confirm C1 tests pass
    - [ ] Commit: `feat(ci): Add GitHub Action for PR graph impact reports`

- [ ] Task: Implement C3 — Workflow template
    - [ ] Create `.github/workflows/repo-graph.yml` template
    - [ ] Configure `pull_request` trigger (opened, synchronize)
    - [ ] Add caching for `graph.db` between runs
    - [ ] Reference the local action or document how to reference a published version
    - [ ] Commit: `ci(template): Add reusable workflow template for repo-graph`

- [ ] Task: Implement C4 — Documentation
    - [ ] Create `docs/CI_CD.md` with setup instructions
    - [ ] Document caching strategy for `graph.db`
    - [ ] Document impact report interpretation
    - [ ] Document `fail-on-impact` configuration
    - [ ] Commit: `docs(ci): Add CI/CD integration documentation`

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
    - [ ] `cp ./bin/repo-graph ~/.local/bin/repo-graph`
    - [ ] Smoke test: run `repo-graph diff` on two real databases and verify output

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
