# Spec: Scanner Extensibility — Config-Driven Edge Types, Route Mode Tags, and Custom File Patterns

## Overview

The build-graph scanner currently hardcodes its edge types, node tag logic, and file inclusion list. This limits adoption for projects with domain-specific relationships (e.g., route-to-schema validation), framework-specific metadata (e.g., Next.js route `mode` exports), and non-TypeScript data files (e.g., JSON seed files, SQL migrations).

This track adds three extensibility mechanisms that let users customize scanner behavior via config and CLI flags without modifying build-graph source code.

---

## Functional Requirements

### FR-1 — Custom Edge Types via Config File

Allow users to register custom edge types through a `build-graph.config.json` file at the project root. The scanner reads this config at scan time and creates edges matching user-defined patterns.

**Config format:**
```json
{
  "customEdges": [
    {
      "type": "validates_with",
      "description": "Route handler validates request body against a schema",
      "sourceType": "route",
      "targetType": "schema",
      "pattern": {
        "sourceImport": "zod",
        "targetName": true
      }
    }
  ]
}
```

**Behavior:**
- `build-graph scan` looks for `build-graph.config.json` in the project root (or a path passed via `--config`).
- If the file exists, parse and validate it. If it doesn't exist, proceed with defaults (no custom edges).
- Custom edge types are appended to the `EdgeType` union in memory at runtime; they are NOT persisted to `contract.ts`.
- Custom edges are stored in the `edges` table like any other edge, with `type` set to the custom name.
- Invalid config (missing `type`, unknown `sourceType`) produces a warning to stderr and skips that entry; it does not halt the scan.

**Config schema (TypeScript):**
```typescript
interface BuildGraphConfig {
  customEdges?: CustomEdgeDef[];
}

interface CustomEdgeDef {
  type: string;              // edge type name (snake_case)
  description?: string;      // human-readable purpose
  sourceType: NodeType;      // expected source node type
  targetType: NodeType;      // expected target node type
  pattern: {
    sourceImport?: string;   // if source file imports this module, emit edge
    targetName?: string;     // match target node by name pattern (glob)
  };
}
```

**CLI integration:**
- `build-graph scan <dir> <db>` — auto-discovers `build-graph.config.json` in `<dir>`
- `build-graph scan <dir> <db> --config <path>` — explicit config path override
- `build-graph init <db>` — no change (config is scan-time only)

---

### FR-2 — Route Mode Tag Extraction

Extract `export const mode = '...'` declarations from route files and store the value as a node tag on the corresponding route node.

**Detected pattern:**
```typescript
// app/practice/[lessonId]/route.ts
export const mode = 'practice';
```

**Behavior:**
- During `scanRoutes`, after identifying a route node, scan the same file for `export const mode = '<value>'`.
- If found, add `mode:<value>` to the route node's `tags` array (e.g., `["param:lessonId", "mode:practice"]`).
- Recognized mode values: `teaching`, `guided`, `practice`, `explore` (but any string is stored; unrecognized values get a `mode:<value>` tag without validation).
- If the file exports `mode` but the value is not a string literal (e.g., a variable reference), log a warning and skip.

**Query examples:**
```sql
-- Find all practice routes
SELECT name, file_path FROM nodes
WHERE type = 'route' AND tags LIKE '%"mode:practice"%';

-- Find all routes with a specific mode
SELECT name, file_path, tags FROM nodes
WHERE type = 'route' AND tags LIKE '%mode:%';
```

---

### FR-3 — Custom Glob Patterns for Non-TS Files

Allow users to pass custom glob patterns to `build-graph scan` so that non-TypeScript files (`.json`, `.sql`, etc.) can be indexed as file nodes.

**CLI syntax:**
```bash
build-graph scan ./ ./graph.db --include "supabase/seed/**/*.json" --include "migrations/**/*.sql"
```

**Behavior:**
- `--include <glob>` can be specified multiple times. Each glob is resolved relative to the project root.
- Matched files are added as `file` nodes with `type = "file"` and their absolute path.
- No AST parsing is performed on non-TS files — they are file-level nodes only (no functions, classes, etc.).
- The scanner's default TS/TSX inclusion remains unchanged. `--include` is additive.
- Files matching `SKIP_DIRS` (node_modules, .git, etc.) are still excluded even if the glob matches them.
- If a glob matches zero files, emit a warning to stderr and continue.

**Contract changes:**
- `ScanArgs` in `contract.ts` gains `includePatterns?: string[]`.
- `cli.ts` parses `--include` flags and threads them through to `handleScan`.
- `build-graph.ts` `handleScan` passes patterns to `createProject` or a new `discoverFiles` function.

---

## Non-Functional Requirements

- Config parsing adds < 50ms to scan time for projects with < 10 custom edge definitions.
- Route mode extraction adds < 10ms per route file.
- `--include` glob resolution adds < 100ms for up to 10 patterns.
- All existing 172+ tests continue to pass without modification.
- New tests cover each feature at ≥ 80% coverage.
- Config file is validated with clear error messages; malformed JSON halts with exit code 3.
- Custom edge types are backward-compatible: old databases without custom edges continue to work.

---

## Acceptance Criteria

- [ ] `build-graph scan ./ ./graph.db` with a `build-graph.config.json` containing `customEdges: [{ type: "validates_with", sourceType: "route", targetType: "schema", pattern: {} }]` produces `validates_with` edges in the database.
- [ ] `build-graph scan ./ ./graph.db --config ./custom-config.json` uses the specified config file.
- [ ] A route file with `export const mode = 'practice'` produces a route node with `"mode:practice"` in its tags array.
- [ ] `build-graph search ./graph.db mode:practice --type=route` returns the tagged route.
- [ ] `build-graph scan ./ ./graph.db --include "supabase/seed/**/*.json"` produces file nodes for matching JSON files.
- [ ] Multiple `--include` flags are all applied (additive).
- [ ] Missing config file does not halt scan; malformed config prints warning and skips.
- [ ] Existing tests pass.

---

## Out of Scope

- AST parsing of non-TS files (JSON, SQL) — they are file-level nodes only.
- Config-driven custom node types (only edge types are configurable in this track).
- Interactive config generation wizard.
- Config file inheritance or extends semantics.
- Runtime config hot-reloading (config is read once at scan start).
