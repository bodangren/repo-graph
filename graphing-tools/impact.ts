import { Database } from "bun:sqlite";
import { join } from "path";
import { getStaleFiles, getProjectRoot, getMetadata } from "./meta";
import { toRelativePath } from "./paths";
import { resolveNode, type ResolvedNode } from "./resolve";
import { buildSnippet } from "./explore";
import { TEST_FILE_PATTERNS } from "./contract";
import {
  type ImpactOutput,
  type FreshnessBlock,
  type RelationshipEntry,
  type NodeType,
  type SourceSnippet,
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
  fromPackage?: string;
  toPackage?: string;
}

/**
 * Run the `impact` command for a single node-or-file root.
 *
 * @param db Graph database to traverse.
 * @param target Node name, node id, or file path to resolve.
 * @param options Traversal, package-filter, source, and output options.
 * @returns Structured blast-radius output with the process exit code.
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
  const resolution = resolveRoot(db, target, projectRoot);
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
  const walk = walkImpact(
    db,
    node.id,
    depth,
    onlyEdgeType,
    limit,
    options.fromPackage,
    options.toPackage,
  );
  const {
    relationships,
    fields,
    components,
    hooks,
    schemas,
    routes,
    paramFlow,
    truncated: walkTruncated,
  } = walk;

  // All output paths are relative to projectRoot when available,
  // including JSON, per the spec output-contract.
  const rel = (p: string) =>
    projectRoot ? toRelativePath(p, projectRoot) : p;
  const displayRelationships = relationships.map((r) => ({
    ...r,
    targetFilePath: rel(r.targetFilePath),
  }));

  // Split relationships by direction for JSON: downstream = forward
  // edges FROM the root (what the root depends on), upstream = backward
  // edges (what depends on the root).
  const upstream = displayRelationships.filter((r) => r.direction === "backward");
  const downstream = displayRelationships.filter((r) => r.direction === "forward");

  // Affected tests: collect all `tested_by` reverse edges plus any
  // file in the same path that matches a test-file pattern.
  const affectedTests = collectAffectedTests(db, node.id);

  // Freshness: include the file(s) of the root node plus any
  // relationships' file paths.
  const freshness = buildFreshnessBlock(db, projectRoot);
  const sourceSnippets = includeSource ? collectSourceSnippets(db, node.id, relationships, projectRoot) : undefined;

  const output: ImpactOutput = {
    root: node.type === "file"
      ? (projectRoot ? toRelativePath(node.filePath, projectRoot) : node.filePath)
      : `${node.type}:${node.name}`,
    relationships: displayRelationships,
    upstream,
    downstream,
    routes: routes.map((s) => relBucket(s, projectRoot)),
    components: components.map((s) => relBucket(s, projectRoot)),
    hooks: hooks.map((s) => relBucket(s, projectRoot)),
    schemas: schemas.map((s) => relBucket(s, projectRoot)),
    fields: fields.map((s) => relBucket(s, projectRoot)),
    paramFlow,
    affectedTests: affectedTests.map(rel),
    freshness,
    truncated: walkTruncated,
    ...(sourceSnippets ? { sourceSnippets } : {}),
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
    }, projectRoot),
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

/**
 * Format impact results as human-readable text.
 *
 * @param result Structured impact output.
 * @param projectRoot Optional root used to relativize displayed paths.
 * @returns Formatted command output.
 */
export function formatImpactText(result: ImpactOutput, projectRoot?: string): string {
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
  if (result.paramFlow.length > 0) {
    lines.push("");
    lines.push("Param flow:");
    for (const p of result.paramFlow) {
      lines.push(`  ${relParamFlowId(p.source, projectRoot)} → ${relParamFlowId(p.target, projectRoot)}`);
    }
  }
  if (result.affectedTests.length > 0) {
    lines.push("");
    lines.push("Affected tests:");
    for (const t of result.affectedTests) lines.push(`  ${t}`);
  }
  if (result.sourceSnippets && result.sourceSnippets.length > 0) {
    lines.push("");
    lines.push("Source snippets:");
    for (const snippet of result.sourceSnippets) {
      lines.push(`  ${snippet.filePath}:${snippet.lineStart}-${snippet.lineEnd}`);
      for (const line of snippet.content.split("\n")) lines.push(`    ${line}`);
    }
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

function resolveRoot(db: Database, target: string, projectRoot?: string): RootResolution {
  const toAbs = (p: string) =>
    projectRoot && !p.startsWith("/") ? join(projectRoot, p) : p;

  // 1a) File node id (e.g. `file:/path/to/file.ts`). Keep the file as
  //     the root; walkImpact expands it to every contained symbol.
  const fileNode = db
    .prepare("SELECT id, type, name, file_path FROM nodes WHERE id = ? AND type = 'file'")
    .get(`file:${toAbs(target)}`) as { id: string; type: string; name: string; file_path: string } | undefined;
  if (fileNode) {
    return {
      kind: "single",
      node: { id: fileNode.id, type: fileNode.type, name: fileNode.name, filePath: fileNode.file_path },
    };
  }
  // 1b) Exact file_path
  const absTarget = toAbs(target);
  const byFilePath = db
    .prepare("SELECT id, type, name, file_path FROM nodes WHERE file_path = ? AND type = 'file'")
    .get(absTarget) as { id: string; type: string; name: string; file_path: string } | undefined;
  if (byFilePath) {
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
  const looksLikeFilePath = /\/[^/]+\.(?:ts|tsx|js|jsx|json|sql)$/.test(absTarget);
  if (looksLikeFilePath) {
    // Even with no persisted node, return a synthetic file root so the
    // caller receives a stable not-yet-indexed result.
    return {
      kind: "single",
      node: { id: `file:${absTarget}`, type: "file", name: absTarget.split("/").pop() ?? absTarget, filePath: absTarget },
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
  paramFlow: Array<{ source: string; target: string; tainted: boolean }>;
  truncated: boolean;
}

function walkImpact(
  db: Database,
  rootId: string,
  depth: number,
  onlyEdgeType: string | undefined,
  limit: number,
  fromPackage?: string,
  toPackage?: string
): WalkResult {
  // The traversal is deliberately implemented in TypeScript rather than a
  // recursive SQL projection. That keeps the persisted edge endpoints and
  // direction intact for every hop and makes cycle handling explicit.
  const edgeFilter = onlyEdgeType
    ? [onlyEdgeType]
    : [...IMPACT_TRAVERSAL_EDGE_TYPES, "has_field", "contains"];
  const placeholders = edgeFilter.map(() => "?").join(",");
  const maxDepth = Math.max(0, depth);
  const relationships: RelationshipEntry[] = [];
  const fields = new Set<string>();
  const components = new Set<string>();
  const hooks = new Set<string>();
  const schemas = new Set<string>();
  const routes = new Set<string>();
  const paramFlow: Array<{ source: string; target: string; tainted: boolean }> = [];
  const seenParamFlow = new Set<string>();
  const seenEdges = new Set<string>();
  const visited = new Set<string>();
  let truncated = false;

  const rootRow = db
    .prepare("SELECT id, type, file_path FROM nodes WHERE id = ?")
    .get(rootId) as { id: string; type: string; file_path: string } | undefined;
  const seeds: Array<{ id: string; path: string[] }> = [{ id: rootId, path: [rootId] }];
  if (rootRow?.type === "file") {
    const contained = db
      .prepare("SELECT target FROM edges WHERE source = ? AND type = 'contains' ORDER BY target")
      .all(rootId) as Array<{ target: string }>;
    const symbolIds = contained.length > 0
      ? contained.map((row) => row.target)
      : (db
          .prepare("SELECT id FROM nodes WHERE file_path = ? AND type != 'file' ORDER BY type, name, id")
          .all(rootRow.file_path) as Array<{ id: string }>).map((row) => row.id);
    for (const symbolId of symbolIds) {
      seeds.push({ id: symbolId, path: [rootId, symbolId] });
    }
  }
  for (const seed of seeds) visited.add(seed.id);

  type FrontierItem = { id: string; depth: number; path: string[] };
  let frontier: FrontierItem[] = seeds.map((seed) => ({ ...seed, depth: 0 }));

  while (frontier.length > 0 && maxDepth > 0 && !truncated) {
    const next: FrontierItem[] = [];
    for (const current of frontier) {
      const rows = db
        .prepare(
          `SELECT e.id AS edge_id, e.source, e.target, e.type AS edge_type,
                  ns.name AS source_name, ns.type AS source_type,
                  ns.file_path AS source_file_path,
                  nt.name AS target_name, nt.type AS target_type,
                  nt.file_path AS target_file_path
           FROM edges e
           JOIN nodes ns ON ns.id = e.source
           JOIN nodes nt ON nt.id = e.target
           WHERE (e.source = ? OR e.target = ?)
             AND e.type IN (${placeholders})
             AND (? IS NULL OR ns.package_id = ?)
             AND (? IS NULL OR nt.package_id = ?)
           ORDER BY e.type, e.source, e.target, e.id`
        )
        .all(current.id, current.id, ...edgeFilter, fromPackage ?? null, fromPackage ?? null, toPackage ?? null, toPackage ?? null) as Array<{
        edge_id: number;
        source: string;
        target: string;
        edge_type: string;
        source_name: string;
        source_type: string;
        source_file_path: string;
        target_name: string;
        target_type: string;
        target_file_path: string;
      }>;

      for (const row of rows) {
        const isForward = row.source === current.id;
        const neighborId = isForward ? row.target : row.source;
        if (neighborId === current.id) continue;
        const direction: "forward" | "backward" = isForward ? "forward" : "backward";
        const edgeKey = `${row.edge_id}:${direction}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);

        if (relationships.length >= limit) {
          truncated = true;
          break;
        }

        const targetName = isForward ? row.target_name : row.source_name;
        const targetFilePath = isForward ? row.target_file_path : row.source_file_path;
        const targetType = isForward ? row.target_type : row.source_type;
        relationships.push({
          sourceId: row.source,
          targetId: row.target,
          edgeType: row.edge_type,
          direction,
          targetName,
          targetFilePath,
          targetType: targetType as NodeType,
          depth: current.depth + 1,
          path: [...current.path, neighborId],
        });
        bucketize(targetType, targetName, targetFilePath, {
          fields,
          components,
          hooks,
          schemas,
          routes,
        });
        if (row.edge_type === "param_flow") {
          const key = `${row.source}->${row.target}`;
          if (!seenParamFlow.has(key)) {
            seenParamFlow.add(key);
            paramFlow.push({ source: row.source, target: row.target, tainted: true });
          }
        }
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          if (current.depth + 1 < maxDepth) {
            next.push({ id: neighborId, depth: current.depth + 1, path: [...current.path, neighborId] });
          }
        }
      }
      if (truncated) break;
    }
    frontier = next;
  }

  relationships.sort((a, b) =>
    (a.depth ?? 0) - (b.depth ?? 0) ||
    a.edgeType.localeCompare(b.edgeType) ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.targetId.localeCompare(b.targetId)
  );

  return {
    relationships,
    fields: Array.from(fields).sort(),
    components: Array.from(components).sort(),
    hooks: Array.from(hooks).sort(),
    schemas: Array.from(schemas).sort(),
    routes: Array.from(routes).sort(),
    paramFlow: paramFlow.sort((a, b) =>
      a.source === b.source ? a.target.localeCompare(b.target) : a.source.localeCompare(b.source)
    ),
    truncated,
  };
}

function collectSourceSnippets(
  db: Database,
  rootId: string,
  relationships: RelationshipEntry[],
  projectRoot?: string
): SourceSnippet[] {
  const ids = [rootId, ...relationships.flatMap((relationship) => [relationship.sourceId, relationship.targetId])];
  const seen = new Set<string>();
  const snippets: SourceSnippet[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = db.prepare("SELECT id, file_path AS filePath, type, name FROM nodes WHERE id = ?").get(id) as {
      id: string;
      filePath: string;
      type: string;
      name: string;
    } | undefined;
    if (!row) continue;
    const snippet = buildSnippet(db, row, projectRoot);
    if (snippet) snippets.push(snippet);
    if (snippets.length >= 10) break;
  }
  return snippets;
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
  const root = db
    .prepare("SELECT type, file_path FROM nodes WHERE id = ?")
    .get(rootId) as { type: string; file_path: string } | undefined;
  if (root?.type === "file") {
    const contained = db
      .prepare("SELECT target FROM edges WHERE source = ? AND type = 'contains'")
      .all(rootId) as Array<{ target: string }>;
    const symbols = contained.length > 0
      ? contained.map((row) => row.target)
      : (db
          .prepare("SELECT id FROM nodes WHERE file_path = ? AND type != 'file'")
          .all(root.file_path) as Array<{ id: string }>).map((row) => row.id);
    for (const id of symbols) {
      reached.add(id);
      frontier.push(id);
    }
  }
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
         WHERE (e.source IN (${placeholders}) OR e.target IN (${placeholders}))
           AND e.type IN (${IMPACT_TRAVERSAL_EDGE_TYPES.map(() => "?").join(",")})`
      )
      .all(...frontier, ...frontier, ...frontier, ...IMPACT_TRAVERSAL_EDGE_TYPES) as Array<{ other: string }>;
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

function buildFreshnessBlock(db: Database, projectRoot?: string): FreshnessBlock {
  const stale = getStaleFiles(db);
  const rel = (p: string) => (projectRoot ? toRelativePath(p, projectRoot) : p);
  const indexedRows = db
    .prepare("SELECT MAX(indexed_at) AS indexed_at FROM files")
    .get() as { indexed_at: number | null };
  const checkedAt = getMetadata(db)?.lastIndexedAt ?? indexedRows.indexed_at ?? 0;
  return {
    stale: stale.map((s) => rel(s.path)).sort(),
    missing: stale.filter((s) => s.reason === "deleted").map((s) => rel(s.path)).sort(),
    checkedAt,
  };
}

/**
 * Render a node id (e.g. `schema:/project/src/db/schema.ts:scienceLessons`)
 * as a human label with the file path relativized when projectRoot is set.
 */
function relParamFlowId(id: string, projectRoot?: string): string {
  const colon = id.indexOf(":");
  if (colon < 0) return id;
  const type = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) {
    return `${type}:${rest}`;
  }
  const filePath = rest.slice(0, lastColon);
  const name = rest.slice(lastColon + 1);
  const relPath = projectRoot ? toRelativePath(filePath, projectRoot) : filePath;
  return `${type}:${name}  ${relPath}`;
}
