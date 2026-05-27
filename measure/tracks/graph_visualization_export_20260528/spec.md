# Spec: Graph Visualization Export (DOT & HTML)

## Overview

The knowledge graph in `graph.db` is powerful for programmatic queries but opaque to human exploration. This track adds export commands that render the graph into two formats:

1. **Graphviz DOT** — a plain-text format suitable for `dot` rendering to PNG/SVG/PDF.
2. **Interactive HTML** — a self-contained web page using D3.js or Cytoscape.js with search, zoom, and filtering controls.

Both exports support filtering by layer, node type, and edge type so users can produce focused diagrams of subsystems.

---

## Functional Requirements

### V1 — DOT Export Command

Add `repo-graph export-dot <db> [options]` that writes a `.dot` file to stdout or a file.

**Options:**
- `--output <path>` — write to file instead of stdout
- `--layer <layer>` — include only nodes in the given layer (repeatable)
- `--node-type <type>` — include only nodes of the given type (repeatable)
- `--edge-type <type>` — include only edges of the given type (repeatable)
- `--from <node>` — start from a specific node and include its transitive closure up to `--depth`
- `--depth <n>` — max traversal depth from `--from` (default: 1)

**DOT formatting:**
- Nodes are grouped by `layer` using `subgraph cluster_*`.
- Node `label` is the node's display name.
- Node `shape` varies by type: `box` (function), `ellipse` (class), `diamond` (interface), `hexagon` (type alias).
- Edge `label` shows the `edge_type`.

### V2 — HTML Export Command

Add `repo-graph export-html <db> [options]` that writes a self-contained `.html` file.

**Options:** Same filter options as DOT export, plus:
- `--title <title>` — page title (default: "repo-graph Visualization")
- `--layout <algorithm>` — `force` (default) or `circle` or `grid`

**Interactive features:**
- **Search**: text input filters nodes by label in real time.
- **Zoom**: mouse wheel + pan (or pinch on touch).
- **Node click**: shows a tooltip panel with node details (type, file path, layer, outgoing/incoming edge counts).
- **Edge hover**: shows edge type tooltip.
- **Legend**: color key for node types and layers.
- **No external dependencies**: all JS/CSS inlined or loaded from a CDN (D3.js or Cytoscape.js via unpkg/jsdelivr).

### V3 — Filter Engine

Both exporters share a filter engine that translates CLI options into a SQL `WHERE` clause.

**Query pattern:**
```sql
SELECT * FROM nodes
WHERE (layer IN (?) OR ? IS NULL)
  AND (node_type IN (?) OR ? IS NULL)
```

For `--from` / `--depth`, a BFS or recursive CTE computes the transitive closure before export.

---

## Non-Functional Requirements

- DOT export of a 10k-node graph must complete in < 5s.
- HTML export of a 10k-node graph must produce a file < 20MB (inline JS is the main cost).
- The HTML page must render smoothly in Chrome/Firefox/Safari with 5k+ nodes (use canvas renderer if needed).
- All existing tests pass without modification.
- New tests must cover filter SQL generation and DOT output formatting (≥ 80% coverage on new modules).

---

## Acceptance Criteria

- [ ] `repo-graph export-dot graph.db --layer domain --edge-type calls > domain.dot` produces valid DOT syntax.
- [ ] `repo-graph export-html graph.db --from "function:src/app.ts:main" --depth 2 -o graph.html` produces a working HTML file.
- [ ] Opening the HTML file in a browser shows an interactive graph with search, zoom, and clickable nodes.
- [ ] Filtering by `--node-type function` excludes all non-function nodes from both exports.
- [ ] The HTML file loads without external network dependencies after the initial page load (CDN assets cached).
- [ ] Existing 172 tests continue to pass.

---

## Out of Scope

- Real-time graph updates in the HTML page (static export only).
- Server-mode web application (use `export-html` and open the file).
- Custom color themes or CSS overrides (default palette only).
- 3D graph rendering (deferred to a follow-up track).
- PDF/PNG rasterization (use `dot` CLI on the DOT output).
