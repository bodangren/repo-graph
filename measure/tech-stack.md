# Tech Stack

## Runtime & Dependencies

| Technology | Version | Purpose |
|------------|---------|---------|
| Bun | 1.2+ | Single runtime for all scripts and tooling |
| `bun:sqlite` | built-in | Native SQLite driver (no external dependency) |
| `ts-morph` | 28.x | TypeScript AST parser and project manager |
| TypeScript | 7.0.2 | Primary CLI and language-service type-check target |
| `@typescript/typescript6` | 6.0.2 | Compatibility compiler for the embedded AST API boundary |
| TypeScript 6 (embedded by `ts-morph`) | 6.0.2 | Programmatic compiler API used by `ts-morph` 28 |

- **Module system:** ES modules (`.ts`)
- **Package manager:** `bun` (built-in)
- **No Python, no Node.js.** All tooling is unified under Bun.
- **No external AI/LLM services.** Structure extraction is purely programmatic.

### Compiler and AST boundary

TypeScript 7 is the primary compiler and language-server target. The project
also runs the official `@typescript/typescript6` compatibility binary so the
source and tests remain valid across the current compiler transition. The
scanner continues to use `ts-morph` 28 and its embedded TypeScript 6.0.2
programmatic API; replacing that API is intentionally deferred until
TypeScript exposes a supported equivalent and `ts-morph` adopts it.

The package uses Bun's side-by-side binary aliases (`tsc` for TypeScript 7 and
`tsc6` for `@typescript/typescript6`). `bun run typecheck` runs the
primary compiler, `bun run typecheck:compat` runs the compatibility compiler,
and `bun run check` runs type checks, lint, build, generated-fact validation,
and the architecture doctor in that order. Release verification also checks
that Bun resolves both binaries to the expected package versions.

---

## Database Schema

```sql
-- Main graph tables
CREATE TABLE nodes (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,    -- file, function, class, interface, type_alias, variable, import, export
  name        TEXT NOT NULL,
  file_path   TEXT NOT NULL,    -- absolute path to source file
  line_start  INTEGER,          -- line number where node begins
  line_end    INTEGER,          -- line number where node ends
  summary     TEXT,             -- JSDoc comment or empty
  tags        TEXT,             -- JSON array: '["public","deprecated","async"]'
  complexity  TEXT,             -- simple, moderate, complex (derived from AST metrics)
  language_notes TEXT,          -- e.g. "generic", "overloaded", "decorated"
  layer_id    TEXT              -- FK to layers.id, computed from import patterns
);

CREATE TABLE edges (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL,    -- node id
  target      TEXT NOT NULL,    -- node id
  type        TEXT NOT NULL,    -- imports, calls, contains, extends, implements, exports, depends_on, tested_by
  direction   TEXT NOT NULL,    -- forward, backward, bidirectional
  weight      REAL DEFAULT 0.5
);

CREATE TABLE layers (
  id          TEXT PRIMARY KEY,  -- e.g. "layer:data-access"
  name        TEXT NOT NULL,
  description TEXT,
  node_ids    TEXT               -- JSON array of node ids
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
  SELECT e.target, e.target, 1,
         e.source || ' -> ' || e.target,
         e.type
    FROM edges e
   WHERE e.source = :source_id

  UNION ALL

  SELECT e.target, e.target, p.depth + 1,
         p.path || ' -> ' || e.target,
         p.types || ',' || e.type
    FROM edges e
    JOIN path p ON e.source = p.current_id
   WHERE p.depth < :max_hops
     AND p.path NOT LIKE '%' || e.target || '%'
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
SELECT id, type, name, line_start, line_end, summary
FROM nodes
WHERE file_path = :file_path
ORDER BY line_start;
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

## Build Integration

In `graphing-tools/`:

```typescript
// scanner.ts
import { Project } from "ts-morph";
import { Database } from "bun:sqlite";

export async function scanProject(projectRoot: string, dbPath: string) {
  const project = new Project({ tsConfigFilePath: `${projectRoot}/tsconfig.json` });
  const db = new Database(dbPath);

  createSchema(db);
  createIndexes(db);

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    // Extract file node
    const fileNodeId = `file:${filePath}`;
    insertNode(db, fileNodeId, "file", filePath.split("/").pop()!, filePath);

    // Extract functions
    for (const func of sourceFile.getFunctions()) {
      const funcId = `function:${filePath}:${func.getName() || "anonymous"}`;
      insertNode(db, funcId, "function", func.getName() || "anonymous", filePath,
        func.getStartLineNumber(), func.getEndLineNumber());
      insertEdge(db, fileNodeId, funcId, "contains", "forward");
    }

    // Extract classes
    for (const cls of sourceFile.getClasses()) {
      const clsId = `class:${filePath}:${cls.getName() || "anonymous"}`;
      insertNode(db, clsId, "class", cls.getName() || "anonymous", filePath,
        cls.getStartLineNumber(), cls.getEndLineNumber());
      insertEdge(db, fileNodeId, clsId, "contains", "forward");

      // Class inheritance
      const ext = cls.getExtends();
      if (ext) {
        const baseName = ext.getExpression().getText();
        insertEdge(db, clsId, `class:*:${baseName}`, "extends", "forward");
      }
    }

    // Extract imports
    for (const imp of sourceFile.getImportDeclarations()) {
      const modulePath = imp.getModuleSpecifierValue();
      insertEdge(db, fileNodeId, `file:${resolveImport(projectRoot, modulePath)}`, "imports", "forward");
    }
  }

  resolveLayerIds(db);
  db.close();
}
```

Called during initial scan or full rebuild:
```bash
repo-graph scan ./ ./graph.db
```

Called from git hook for incremental updates:
```bash
repo-graph update ./graph.db src/auth.ts src/utils.ts
```

---

## Skill Integration

Add to skill instructions for agents working on the codebase:

```markdown
## Query Interface

The codebase is mapped in `./graph.db` (SQLite).
Use `sqlite3` or write SQL directly via `bun:sqlite`.

### Schema

```sql
nodes(id, type, name, file_path, line_start, line_end, summary, tags, complexity, language_notes, layer_id)
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
├── scanner.ts         -- ts-morph AST extraction → SQLite
├── schema.ts          -- CREATE TABLE + indexes
├── indexes.ts         -- Index creation
├── query.ts           -- Common query functions (agent-facing API)
├── repo-graph.ts      -- canonical CLI entry point (scan, update, query, search)
├── README.md          -- Usage guide
└── legacy/            -- Old Node.js/Python scripts (to be replaced)
```
