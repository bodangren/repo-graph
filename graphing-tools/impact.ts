import { Database } from "bun:sqlite";
import { getStaleFiles, getProjectRoot } from "./meta";
import { toRelativePath } from "./paths";
import { resolveNode, type ResolvedNode } from "./resolve";
import { TEST_FILE_PATTERNS } from "./contract";
import {
  type ImpactOutput,
  type FreshnessBlock,
  type RelationshipEntry,
  type NodeType,
  ExitCode,
  IMPACT_TRAVERSAL_EDGE_TYPES,
  OutputLimits,
} from "./contract";

/**
 * Public output of a single `runImpact` invocation. `output` is the
 * human-readable text or serialized JSON string; `exitCode` follows
 * the standard Measure exit-code taxonomy.
 */
export interface ImpactResult {
  output: string;
  exitCode: ExitCodeValue;
}

type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

interface ImpactOptions {
  depth?: number;
  edgeType?: string;
  includeSource?: boolean;
  projectRoot?: string;
  json?: boolean;
}

/**
 * Run the `impact` command for a single node-or-file root. Resolves
 * the root to one or more nodes via `resolveNode` and walks incoming
 * and outgoing edges up to `depth` hops, surfacing routes,
 * components, hooks, schemas/fields, and param-flow edges
 * prominently.
 */
export function runImpact(
  db: Database,
  target: string,
  options: ImpactOptions = {}
): ImpactResult {
  const projectRoot = options.projectRoot ?? getProjectRoot(db);
  const depth = options.depth ?? OutputLimits.traversalDepth;
  const includeSource = options.includeSource ?? false;
  const onlyEdgeType = options.edgeType;
  const limit = OutputLimits.relationshipFanout;

  // Resolution: try (1) exact file path, (2) exact node id, (3) name
  // (case-insensitive), (4) partial name.
  const resolution = resolveRoot(db, target);
  if (resolution.kind === "none") {
    if (options.json) {
      return {
        output: JSON.stringify({ root: target, found: false }),
        exitCode: ExitCode.NotFound,
      };
    }
    return { output: "(no matches)", exitCode: ExitCode.NotFound };
  }
  if (resolution.kind === "ambiguous") {
    console.error("Ambiguous name — multiple nodes match:");
    for (const r of resolution.matches) {
      console.error(`  ${r.type}:${r.name}  ${r.filePath}`);
    }
    if (options.json) {
      return {
        output: JSON.stringify({ root: target, ambiguous: true }),
        exitCode: ExitCode.Ambiguous,
      };
    }
    return { output: "", exitCode: ExitCode.Ambiguous };
  }

  const node = resolution.node;
  const { relationships, fields, components, hooks, schemas, routes } = walkImpact(
    db,
    node.id,
    depth,
    onlyEdgeType,
    limit
  );

  // Make text output use relative paths. JSON output keeps absolute
  // paths for the relationship targetFilePath field (the spec is
  // explicit: "All file paths in output are relative to projectRoot"
  // applies to text output; JSON preserves raw values for downstream
  // tooling).
  const rel = (p: string) =>
    projectRoot ? toRelativePath(p, projectRoot) : p;
  const displayRelationships = relationships.map((r) => ({
    ...r,
    targetFilePath: rel(r.targetFilePath),
  }));

  // Affected tests: collect all `tested_by` reverse edges plus any
  // file in the same path that matches a test-file pattern.
  const affectedTests = collectAffectedTests(db, node.id);

  // Freshness: include the file(s) of the root node plus any
  // relationships' file paths.
  const freshness = buildFreshnessBlock(db, projectRoot);

  const output: ImpactOutput = {
    root: node.type === "file"
      ? (projectRoot ? toRelativePath(node.filePath, projectRoot) : node.filePath)
      : `${node.type}:${node.name}`,
    relationships,
    affectedTests,
    freshness,
    truncated: relationships.length >= limit,
  };

  if (options.json) {
    return {
      output: JSON.stringify(output),
      exitCode: ExitCode.Success,
    };
  }

  return {
    output: formatImpactText({
      ...output,
      relationships: displayRelationships,
      routes: routes.map((s) => relBucket(s, projectRoot)),
      components: components.map((s) => relBucket(s, projectRoot)),
      hooks: hooks.map((s) => relBucket(s, projectRoot)),
      schemas: schemas.map((s) => relBucket(s, projectRoot)),
      fields: fields.map((s) => relBucket(s, projectRoot)),
      affectedTests: affectedTests.map(rel),
    }),
    exitCode: ExitCode.Success,
  };
}

/**
 * Transform a `"type:name  filePath"` bucket entry to a relative-path
 * version. Only the file-path suffix is rewritten.
 */
function relBucket(label: string, projectRoot: string | undefined): string {
  if (!projectRoot) return label;
  const idx = label.lastIndexOf("  ");
  if (idx < 0) return label;
  const head = label.slice(0, idx);
  const filePath = label.slice(idx + 2);
  return `${head}  ${toRelativePath(filePath, projectRoot)}`;
}

/** Format the impact output as human-readable text. */
export function formatImpactText(
  result: ImpactOutput & {
    routes: string[];
    components: string[];
    hooks: string[];
    schemas: string[];
    fields: string[];
  }
): string {
  const lines: string[] = [];
  lines.push(`Impact: ${result.root}`);
  lines.push("");
  if (result.relationships.length === 0) {
    lines.push("(no relationships)");
  } else {
    lines.push(`Relationships (${result.relationships.length}):`);
    for (const r of result.relationships) {
      lines.push(`  ${r.edgeType} → ${r.targetName}  ${r.targetFilePath}`);
    }
  }
  if (result.routes.length > 0) {
    lines.push("");
    lines.push("Routes:");
    for (const r of result.routes) lines.push(`  ${r}`);
  }
  if (result.components.length > 0) {
    lines.push("");
    lines.push("Components:");
    for (const c of result.components) lines.push(`  ${c}`);
  }
  if (result.hooks.length > 0) {
    lines.push("");
    lines.push("Hooks:");
    for (const h of result.hooks) lines.push(`  ${h}`);
  }
  if (result.schemas.length > 0) {
    lines.push("");
    lines.push("Schemas:");
    for (const s of result.schemas) lines.push(`  ${s}`);
  }
  if (result.fields.length > 0) {
    lines.push("");
    lines.push("Fields:");
    for (const f of result.fields) lines.push(`  ${f}`);
  }
  if (result.affectedTests.length > 0) {
    lines.push("");
    lines.push("Affected tests:");
    for (const t of result.affectedTests) lines.push(`  ${t}`);
  }
  if (result.freshness.stale.length > 0) {
    lines.push("");
    lines.push("Stale files (re-scan recommended):");
    for (const s of result.freshness.stale) lines.push(`  ${s}`);
  }
  return lines.join("\n");
}

// ── Internal types ─────────────────────────────────────────────────────────

type RootResolution =
  | { kind: "single"; node: ResolvedNode }
  | { kind: "ambiguous"; matches: ResolvedNode[] }
  | { kind: "none" };

// ── Internal helpers ───────────────────────────────────────────────────────

function resolveRoot(db: Database, target: string): RootResolution {
  // 1a) File node id (e.g. `file:/path/to/file.ts`). Prefer a
  //     non-file child so the impact walk surfaces the symbol's
  //     edges, not the (often empty) edges of the file node.
  const fileNode = db
    .prepare("SELECT id, type, name, file_path FROM nodes WHERE id = ? AND type = 'file'")
    .get(`file:${target}`) as { id: string; type: string; name: string; file_path: string } | undefined;
  if (fileNode) {
    const child = db
      .prepare(
        "SELECT id, type, name, file_path FROM nodes WHERE file_path = ? AND type != 'file' ORDER BY type LIMIT 1"
      )
      .get(fileNode.file_path) as { id: string; type: string; name: string; file_path: string } | undefined;
    if (child) {
      return {
        kind: "single",
        node: { id: child.id, type: child.type, name: child.name, filePath: child.file_path },
      };
    }
    return {
      kind: "single",
      node: { id: fileNode.id, type: fileNode.type, name: fileNode.name, filePath: fileNode.file_path },
    };
  }
  // 1b) Exact file_path
  const byFilePath = db
    .prepare("SELECT id, type, name, file_path FROM nodes WHERE file_path = ? AND type = 'file'")
    .get(target) as { id: string; type: string; name: string; file_path: string } | undefined;
  if (byFilePath) {
    // Prefer a non-file symbol inside the file (schema, function, etc.)
    // so the impact walk surfaces the symbol's incoming and outgoing
    // edges, not just the (often empty) edges of the file node.
    const child = db
      .prepare(
        "SELECT id, type, name, file_path FROM nodes WHERE file_path = ? AND type != 'file' ORDER BY type LIMIT 1"
      )
      .get(target) as { id: string; type: string; name: string; file_path: string } | undefined;
    if (child) {
      return {
        kind: "single",
        node: { id: child.id, type: child.type, name: child.name, filePath: child.file_path },
      };
    }
    return {
      kind: "single",
      node: { id: byFilePath.id, type: byFilePath.type, name: byFilePath.name, filePath: byFilePath.file_path },
    };
  }
  // 2) If `target` looks like a real file path (ends with a known
  //    extension and contains a path separator) but no file node
  //    matches, pick the first non-file symbol in that file so the
  //    caller still gets useful impact data. We deliberately skip
  //    this branch for fully-qualified node ids (which contain
  //    `<type>:<file_path>:<name>` and end in a symbol name, not an
  //    extension) — those are handled by the next branch.
  const looksLikeFilePath = /\/[^/]+\.(?:ts|tsx|js|jsx|json|sql)$/.test(target);
  if (looksLikeFilePath) {
    const symbolInFile = db
      .prepare(
        "SELECT id, type, name, file_path FROM nodes WHERE file_path = ? AND type != 'file' ORDER BY type LIMIT 1"
      )
      .get(target) as { id: string; type: string; name: string; file_path: string } | undefined;
    if (symbolInFile) {
      return {
        kind: "single",
        node: { id: symbolInFile.id, type: symbolInFile.type, name: symbolInFile.name, filePath: symbolInFile.file_path },
      };
    }
    // Even with no symbol, return a synthetic file node so the
    // caller's exit code is Success and they can see the path in the
    // output.
    return {
      kind: "single",
      node: { id: `file:${target}`, type: "file", name: target.split("/").pop() ?? target, filePath: target },
    };
  }
  // 3) `<type>:<name>` short form (e.g. `schema:scienceLessons`)
  if (target.includes(":")) {
    const colon = target.indexOf(":");
    const t = target.slice(0, colon);
    const n = target.slice(colon + 1);
    const byTypeName = db
      .prepare(
        "SELECT id, type, name, file_path FROM nodes WHERE type = ? AND name = ?"
      )
      .all(t, n) as Array<{ id: string; type: string; name: string; file_path: string }>;
    if (byTypeName.length === 1) {
      const r = byTypeName[0];
      return {
        kind: "single",
        node: { id: r.id, type: r.type, name: r.name, filePath: r.file_path },
      };
    }
    if (byTypeName.length > 1) {
      return {
        kind: "ambiguous",
        matches: byTypeName.map((r) => ({
          id: r.id,
          type: r.type,
          name: r.name,
          filePath: r.file_path,
        })),
      };
    }
  }
  // 4) Use the shared resolveNode for name/id lookups
  return resolveNode(db, target) as RootResolution;
}

interface WalkResult {
  relationships: RelationshipEntry[];
  fields: string[];
  components: string[];
  hooks: string[];
  schemas: string[];
  routes: string[];
}

function walkImpact(
  db: Database,
  rootId: string,
  depth: number,
  onlyEdgeType: string | undefined,
  limit: number
): WalkResult {
  // Impact walks BOTH directions and a broader set of edges than
  // `affected` because callers want to see the full neighbourhood of
  // a symbol. `IMPACT_TRAVERSAL_EDGE_TYPES` covers reverse impact;
  // for forward/structural edges (contains, has_field) we add them
  // here.
  const EXTENDED_EDGE_TYPES: readonly string[] = [
    ...IMPACT_TRAVERSAL_EDGE_TYPES,
    "has_field",
    "contains",
  ];
  const edgeFilter = onlyEdgeType
    ? [onlyEdgeType]
    : Array.from(EXTENDED_EDGE_TYPES);
  const placeholders = edgeFilter.map(() => "?").join(",");

  const relationships: RelationshipEntry[] = [];
  const fields = new Set<string>();
  const components = new Set<string>();
  const hooks = new Set<string>();
  const schemas = new Set<string>();
  const routes = new Set<string>();

  function pushRel(
    sourceId: string,
    targetId: string,
    edgeType: string,
    direction: "forward" | "backward",
    targetName: string,
    targetFilePath: string,
    targetType: string
  ): void {
    if (sourceId === targetId) return;
    relationships.push({
      sourceId,
      targetId,
      edgeType: edgeType as RelationshipEntry["edgeType"],
      direction,
      targetName,
      targetFilePath,
      targetType: targetType as NodeType,
    });
    bucketize(targetType, targetName, targetFilePath, {
      fields,
      components,
      hooks,
      schemas,
      routes,
    });
  }

  if (depth <= 1) {
    // Single-hop: outgoing + incoming
    const outgoing = db
      .prepare(
        `SELECT e.type AS edge_type, e.target AS target_id, n.type AS target_type,
                n.name AS target_name, n.file_path AS target_file_path
         FROM edges e
         JOIN nodes n ON n.id = e.target
         WHERE e.source = ?
           AND e.type IN (${placeholders})
         ORDER BY e.type, n.name
         LIMIT ?`
      )
      .all(rootId, ...edgeFilter, limit) as Array<{
      edge_type: string;
      target_id: string;
      target_type: string;
      target_name: string;
      target_file_path: string;
    }>;
    for (const o of outgoing) {
      pushRel(rootId, o.target_id, o.edge_type, "forward", o.target_name, o.target_file_path, o.target_type);
    }
    const incoming = db
      .prepare(
        `SELECT e.type AS edge_type, e.source AS source_id, n.type AS source_type,
                n.name AS source_name, n.file_path AS source_file_path
         FROM edges e
         JOIN nodes n ON n.id = e.source
         WHERE e.target = ?
           AND e.type IN (${placeholders})
         ORDER BY e.type, n.name
         LIMIT ?`
      )
      .all(rootId, ...edgeFilter, limit) as Array<{
      edge_type: string;
      source_id: string;
      source_type: string;
      source_name: string;
      source_file_path: string;
    }>;
    for (const i of incoming) {
      pushRel(i.source_id, rootId, i.edge_type, "backward", i.source_name, i.source_file_path, i.source_type);
    }
  } else {
    // Multi-hop: recursive CTE that walks both directions up to
    // `depth` hops. Each non-root node is reported as a relationship
    // to its parent in the walk; the direction reflects whether the
    // source or target of the underlying edge is closer to the root.
    const sql = `
      WITH RECURSIVE walk(id, parent_id, parent_dir, depth, edge_type) AS (
        SELECT ?, NULL, NULL, 0, NULL
        UNION ALL
        SELECT
          CASE WHEN e.source = w.id THEN e.target ELSE e.source END,
          w.id,
          CASE WHEN e.source = w.id THEN 'forward' ELSE 'backward' END,
          w.depth + 1,
          e.type
        FROM walk w
        JOIN edges e ON (e.source = w.id OR e.target = w.id)
                       AND e.type IN (${placeholders})
        WHERE w.depth < ?
          AND (w.parent_id IS NULL
               OR CASE WHEN e.source = w.id THEN e.target ELSE e.source END != w.parent_id)
      )
      SELECT DISTINCT w.id, w.parent_id, w.parent_dir, w.edge_type,
             n.name AS node_name, n.type AS node_type, n.file_path AS node_file_path
      FROM walk w
      JOIN nodes n ON n.id = w.id
      WHERE w.depth > 0
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(rootId, ...edgeFilter, depth, limit) as Array<{
      id: string;
      parent_id: string;
      parent_dir: "forward" | "backward" | null;
      edge_type: string;
      node_name: string;
      node_type: string;
      node_file_path: string;
    }>;
    for (const r of rows) {
      const direction: "forward" | "backward" =
        r.parent_dir === "forward" ? "backward" : "forward";
      pushRel(
        direction === "forward" ? rootId : r.id,
        direction === "forward" ? r.id : rootId,
        r.edge_type,
        direction,
        r.node_name,
        r.node_file_path,
        r.node_type
      );
    }
  }

  return {
    relationships,
    fields: Array.from(fields).sort(),
    components: Array.from(components).sort(),
    hooks: Array.from(hooks).sort(),
    schemas: Array.from(schemas).sort(),
    routes: Array.from(routes).sort(),
  };
}

function bucketize(
  type: string,
  name: string,
  filePath: string,
  out: { fields: Set<string>; components: Set<string>; hooks: Set<string>; schemas: Set<string>; routes: Set<string> }
): void {
  const label = `${type}:${name}  ${filePath}`;
  if (type === "field") out.fields.add(label);
  if (type === "schema") out.schemas.add(label);
  if (type === "function" && /use[A-Z]/.test(name)) out.hooks.add(label);
  if (isRoutePath(filePath)) out.routes.add(label);
  if (/\/components?\//.test(filePath) && /\.[jt]sx?$/.test(filePath)) {
    out.components.add(label);
  }
}

function isRoutePath(p: string): boolean {
  return /\/app\/.*\/(?:page|layout|route)\.[jt]sx?$/.test(p) ||
    /\/pages\/.*\.[jt]sx?$/.test(p) ||
    /\/api\/.*\.(?:ts|tsx|js|jsx)$/.test(p);
}

function collectAffectedTests(db: Database, rootId: string): string[] {
  // Walk the full graph rooted at `rootId` and collect every test
  // file reachable through any edge type. The walk is bounded by a
  // small hop count to stay responsive on large graphs.
  const MAX_HOPS = 6;
  const reached = new Set<string>([rootId]);
  let frontier: string[] = [rootId];
  const testFileIds = new Set<string>();
  // Pre-collect test file node ids for fast membership check
  const testFileNodeRows = db
    .prepare("SELECT id, file_path FROM nodes WHERE type = 'file'")
    .all() as Array<{ id: string; file_path: string }>;
  const idToFilePath = new Map<string, string>();
  for (const r of testFileNodeRows) {
    idToFilePath.set(r.id, r.file_path);
    if (matchesAnyTestPattern(r.file_path)) testFileIds.add(r.id);
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (frontier.length === 0) break;
    const placeholders = frontier.map(() => "?").join(",");
    const next = db
      .prepare(
        `SELECT DISTINCT CASE WHEN e.source IN (${placeholders}) THEN e.target ELSE e.source END AS other
         FROM edges e
         WHERE e.source IN (${placeholders}) OR e.target IN (${placeholders})`
      )
      .all(...frontier, ...frontier, ...frontier) as Array<{ other: string }>;
    const newFrontier: string[] = [];
    for (const { other } of next) {
      if (reached.has(other)) continue;
      reached.add(other);
      newFrontier.push(other);
    }
    frontier = newFrontier;
  }

  const set = new Set<string>();
  for (const id of reached) {
    if (testFileIds.has(id)) {
      const p = idToFilePath.get(id);
      if (p) set.add(p);
    }
  }
  return Array.from(set).sort();
}

function matchesAnyTestPattern(filePath: string): boolean {
  for (const pat of TEST_FILE_PATTERNS) {
    if (patternToRegex(pat).test(filePath)) return true;
  }
  return false;
}

function patternToRegex(pat: string): RegExp {
  // Convert a glob-like pattern to a regex that matches anywhere in
  // the path. `__tests__/**` should match any path that contains a
  // `__tests__/` segment, not only paths that *start* with one.
  const escaped = pat
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*");
  return new RegExp(escaped);
}

function buildFreshnessBlock(db: Database, _projectRoot?: string): FreshnessBlock {
  const stale = getStaleFiles(db);
  return {
    stale: stale.map((s) => s.path).sort(),
    missing: stale.filter((s) => s.reason === "deleted").map((s) => s.path).sort(),
    checkedAt: 0,
  };
}
