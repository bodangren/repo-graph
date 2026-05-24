# Tech Stack

## Runtime & Dependencies

| Technology | Version | Purpose |
|------------|---------|---------|
| Bun | 1.2+ | Single runtime for all scripts and tooling |
| `bun:sqlite` | built-in | Native SQLite driver (no external dependency) |

- **Module system:** ES modules (`.ts` / `.mjs`)
- **Package manager:** `bun` (built-in)
- **No Python, no Node.js.** All tooling is unified under Bun.
- **Note:** Existing `graphing-tools/` scripts are currently Node.js/Python and will be migrated to Bun in a future track.

---

## Database Schema

```sql
-- Main graph tables
CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,  -- e.g. "file:src/auth.ts", "function:src/auth.ts:validateToken"
  type        TEXT NOT NULL,    -- file, function, class, config, document, service, pipeline, schema, resource, table, endpoint, module, concept
  name        TEXT NOT NULL,
  file_path   TEXT,              -- NULL for non-file nodes (functions, classes)
  summary     TEXT,
  tags        TEXT,              -- JSON array as text: '["api-handler","auth"]'
  complexity  TEXT,              -- simple, moderate, complex
  language_notes TEXT,
  layer_id    TEXT               -- FK to layers.id, NULL until architecture phase
);

CREATE TABLE edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,    -- node id
  target      TEXT NOT NULL,    -- node id
  type        TEXT NOT NULL,    -- imports, calls, contains, inherits, implements, exports, depends_on, tested_by, configures, documents, deploys, triggers, etc.
  direction   TEXT NOT NULL,    -- forward, backward, bidirectional
  weight      REAL DEFAULT 0.5
);

CREATE TABLE layers (
  id          TEXT PRIMARY KEY,  -- e.g. "layer:data-access"
  name        TEXT NOT NULL,
  description TEXT,
  node_ids    TEXT               -- JSON array of node ids in this layer
);

CREATE TABLE tour_steps (
  order_index INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  node_ids    TEXT               -- JSON array
);

-- Indexes for common query patterns
CREATE INDEX idx_nodes_type      ON nodes(type);
CREATE INDEX idx_nodes_name      ON nodes(name);
CREATE INDEX idx_nodes_file_path ON nodes(file_path);
CREATE INDEX idx_nodes_layer_id  ON nodes(layer_id);
CREATE INDEX idx_edges_source    ON edges(source);
CREATE INDEX idx_edges_target    ON edges(target);
CREATE INDEX idx_edges_type      ON edges(type);
```

---

## Query Patterns

### find_nodes — fuzzy search across name, summary, tags

```sql
SELECT id, type, name, summary, tags
FROM nodes
WHERE name    LIKE '%' || :query || '%'
   OR summary LIKE '%' || :query || '%'
   OR tags    LIKE '%' || :query || '%'
ORDER BY type, name
LIMIT 20;
```

### get_dependencies — downstream (what X imports/calls/depends on)

```sql
SELECT e.target AS id, e.type AS edge_type, n.name, n.summary
FROM edges e
JOIN nodes n ON e.target = n.id
WHERE e.source = :node_id
  AND e.type IN ('imports', 'calls', 'depends_on', 'contains')
ORDER BY e.type;
```

### get_dependents — upstream (what imports/calls X)

```sql
SELECT e.source AS id, e.type AS edge_type, n.name, n.summary
FROM edges e
JOIN nodes n ON e.source = n.id
WHERE e.target = :node_id
  AND e.type IN ('imports', 'calls', 'depends_on', 'contains')
ORDER BY e.type;
```

### trace_path — multi-hop traversal (A → B → C)

```sql
WITH RECURSIVE path(
  current_id, target_id, depth, path, types
) AS (
  -- Anchor: start from source node
  SELECT e.target, e.target, 1,
         e.source || ' -> ' || e.target,
         e.type
    FROM edges e
   WHERE e.source = :source_id

  UNION ALL

  -- Recursive: follow edges from current node
  SELECT e.target, e.target, p.depth + 1,
         p.path || ' -> ' || e.target,
         p.types || ',' || e.type
    FROM edges e
    JOIN path p ON e.source = p.current_id
   WHERE p.depth < :max_hops
     AND p.path NOT LIKE '%' || e.target || '%'  -- no cycles
)
SELECT path, types, depth
FROM path
WHERE current_id = :target_id
ORDER BY depth
LIMIT 1;
```

### get_layer_nodes — all nodes in an architectural layer

```sql
SELECT n.*
FROM nodes n
JOIN layers l ON n.layer_id = l.id
WHERE l.id = :layer_id;
```

### get_file_tree — all nodes for a given file path

```sql
SELECT id, type, name, line_range, summary
FROM nodes
WHERE file_path = :file_path
   OR id LIKE 'file:' || :file_path || '%'
ORDER BY type;
```

### aggregation — count nodes by type, tag distribution

```sql
SELECT type, COUNT(*) AS count
FROM nodes
GROUP BY type
ORDER BY count DESC;

SELECT json_each.value AS tag, COUNT(*) AS count
FROM nodes, json_each(nodes.tags)
GROUP BY json_each.value
ORDER BY count DESC
LIMIT 20;
```

---

## Build Integration (Phase 7)

In `graphing-tools/`:

```typescript
// build-graph-db.ts
import { Database } from "bun:sqlite";

export function buildGraphDb(kgPath: string, dbPath: string) {
  const db = new Database(dbPath);
  const kg = await Bun.file(kgPath).json();

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (...);
    CREATE TABLE IF NOT EXISTS edges (...);
    CREATE INDEX idx_nodes_type ON nodes(type);
    CREATE INDEX idx_edges_source ON edges(source);
    CREATE INDEX idx_edges_target ON edges(target);
  `);

  // Insert nodes
  const insertNode = db.prepare(`INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?)`);
  for (const n of kg.nodes) {
    insertNode.run(n.id, n.type, n.name, n.filePath, n.summary, JSON.stringify(n.tags), n.complexity, n.languageNotes, null);
  }

  // Insert edges
  const insertEdge = db.prepare(`INSERT INTO edges (source,target,type,direction,weight) VALUES (?,?,?,?,?)`);
  for (const e of kg.edges) {
    insertEdge.run(e.source, e.target, e.type, e.direction, e.weight);
  }

  // Insert layers
  const insertLayer = db.prepare(`INSERT INTO layers VALUES (?,?,?,?)`);
  for (const l of kg.layers) {
    insertLayer.run(l.id, l.name, l.description, JSON.stringify(l.nodeIds));
  }

  // Update node layer_id
  db.exec(`
    UPDATE nodes SET layer_id = (
      SELECT id FROM layers WHERE json_each(layers.node_ids) = nodes.id
    )
  `);

  db.close();
}
```

Called from Phase 7 after graph validation:
```bash
bun run graphing-tools/build-graph-db.ts \
  $PROJECT_ROOT/.understand-anything/knowledge-graph.json \
  $PROJECT_ROOT/.understand-anything/graph.db
```

---

## Skill Integration (`/understand-chat`)

Add to skill instructions:

```markdown
## Query Interface

The knowledge graph is stored in `.understand-anything/graph.db` (SQLite).
Use `sqlite3` as a tool — run queries directly.

### Schema

```sql
nodes(id, type, name, file_path, summary, tags, complexity, language_notes, layer_id)
edges(id, source, target, type, direction, weight)
layers(id, name, description, node_ids)
tour_steps(order_index, title, description, node_ids)
```

### Query Templates

**Find nodes by keyword:**
```sql
SELECT id, type, name, summary FROM nodes
WHERE name LIKE '%:keyword%' OR summary LIKE '%:keyword%' LIMIT 20;
```

**Get downstream dependencies:**
```sql
SELECT e.target, e.type, n.name FROM edges e JOIN nodes n ON e.target=n.id
WHERE e.source=:node_id AND e.type IN ('imports','calls','depends_on');
```

**Multi-hop path trace:**
```sql
WITH RECURSIVE path(current_id, depth, path) AS (
  SELECT e.target, 1, e.source||' -> '||e.target FROM edges e WHERE e.source=:start
  UNION ALL
  SELECT e.target, p.depth+1, p.path||' -> '||e.target FROM edges e JOIN path p ON e.source=p.current_id
  WHERE p.depth < 5 AND p.path NOT LIKE '%'||e.target||'%'
)
SELECT path FROM path WHERE current_id=:end ORDER BY depth LIMIT 1;
```

**Layer membership:**
```sql
SELECT n.* FROM nodes n JOIN layers l ON n.layer_id=l.id WHERE l.id=:layer_id;
```
```

---

## File Layout

```
graphing-tools/
├── SCHEMA.md          -- Full CREATE TABLE statements + indexes
├── QUERIES.md         -- Query pattern reference (find, deps, trace, etc.)
├── build-graph-db.ts  -- Build script (Bun, runs in Phase 7)
└── README.md          -- Integration guide for /understand-chat skill
```

Optionally promoted into `packages/core/` or `understand-anything-plugin/` at:
```
understand-anything-plugin/
└── graphing-tools/
    ├── build-graph-db.ts
    ├── schema.sql
    └── queries.md
```
