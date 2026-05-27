# Implementation Plan: Graph Visualization Export (DOT & HTML)

Features are implemented in dependency order: shared filter engine first, then DOT export, then HTML export. Each task follows TDD. Commit after each top-level task.

---

## Phase 1 — Contract & Filter Engine

Update `contract.ts` and create the shared filter engine before writing exporter tests.

- [ ] Task: Add export options to contract
    - [ ] Add `ExportOptions` interface with `layers`, `nodeTypes`, `edgeTypes`, `fromNode`, `depth`, `outputPath`, `title`, `layout`
    - [ ] Add `GraphNode` and `GraphEdge` selection types for export

- [ ] Task: Measure - User Manual Verification 'Phase 1' (Protocol in workflow.md)

---

## Phase 2 — Tests (Red Phase)

Write all failing tests before touching exporter implementation.

- [ ] Task: Tests V3 — Filter engine (`filter.test.ts`)
    - [ ] Add: Filter by single layer returns only matching nodes and their edges
    - [ ] Add: Filter by multiple layers returns union of matching nodes
    - [ ] Add: Filter by node type returns only matching nodes
    - [ ] Add: Filter by edge type returns only matching edges (and their endpoints)
    - [ ] Add: Filter by `--from` with `--depth` returns transitive closure
    - [ ] Add: Combining multiple filters intersects results correctly

- [ ] Task: Tests V1 — DOT export (`dot.test.ts`)
    - [ ] Add: `exportDot` produces valid DOT syntax for a simple graph
    - [ ] Add: Nodes are grouped by layer into subgraph clusters
    - [ ] Add: Node shapes vary by node type
    - [ ] Add: Edge labels show edge type
    - [ ] Add: Filtering excludes non-matching nodes and edges from output

- [ ] Task: Tests V2 — HTML export (`html.test.ts`)
    - [ ] Add: `exportHtml` produces a self-contained HTML file
    - [ ] Add: HTML contains inlined or CDN-linked D3.js / Cytoscape.js
    - [ ] Add: HTML title matches `--title` option
    - [ ] Add: Filtering excludes non-matching nodes and edges from output

- [ ] Task: Measure - User Manual Verification 'Phase 2' (Protocol in workflow.md)

---

## Phase 3 — Implementation (Green Phase)

- [ ] Task: Implement V3 — Shared filter engine
    - [ ] Create `filterEngine.ts` with `buildExportQuery(options)` function
    - [ ] Implement SQL generation for layer, nodeType, edgeType filters
    - [ ] Implement BFS/CTE-based transitive closure for `--from` + `--depth`
    - [ ] Run `bun test`; confirm V3 tests pass
    - [ ] Commit: `feat(export): Add shared filter engine for graph exports`

- [ ] Task: Implement V1 — DOT export
    - [ ] Create `exportDot.ts` with `runExportDot(db, options)` function
    - [ ] Implement DOT subgraph cluster generation per layer
    - [ ] Implement node shape mapping by type
    - [ ] Implement edge label rendering
    - [ ] Integrate into CLI as `repo-graph export-dot <db> [options]`
    - [ ] Run `bun test`; confirm V1 tests pass
    - [ ] Commit: `feat(export): Add Graphviz DOT export command`

- [ ] Task: Implement V2 — HTML export
    - [ ] Create `exportHtml.ts` with `runExportHtml(db, options)` function
    - [ ] Choose D3.js or Cytoscape.js and embed via CDN
    - [ ] Implement force-directed / circle / grid layout options
    - [ ] Implement search input with real-time node filtering
    - [ ] Implement zoom and pan controls
    - [ ] Implement node click tooltip panel with details
    - [ ] Implement edge hover tooltip
    - [ ] Implement legend with color key
    - [ ] Integrate into CLI as `repo-graph export-html <db> [options]`
    - [ ] Run `bun test`; confirm V2 tests pass
    - [ ] Commit: `feat(export): Add interactive HTML visualization export`

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
    - [ ] Smoke test: export a real project to DOT and HTML, open HTML in browser

- [ ] Task: Measure - User Manual Verification 'Phase 4' (Protocol in workflow.md)
