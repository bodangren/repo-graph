import { Database } from "bun:sqlite";
import { readFileSync, existsSync, statSync } from "fs";
import { searchNodes } from "./search";
import { getMetadata, getStaleFiles, getProjectRoot } from "./meta";
import { toRelativePath } from "./paths";
import {
  type ExploreArgs,
  type ExploreOutput,
  type RelationshipEntry,
  type SourceSnippet,
  type FreshnessBlock,
  type NodeType,
  OutputLimits,
  ExitCode,
  IMPACT_TRAVERSAL_EDGE_TYPES,
} from "./contract";

/**
 * Public output of a single `runExplore` invocation. `output` is the
 * human-readable text or serialized JSON string, and `exitCode` follows
 * the standard Measure exit-code taxonomy.
 */
export interface ExploreResult {
  output: string;
  exitCode: ExitCodeValue;
}

type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

interface ExploreOptions {
  depth?: number;
  limit?: number;
  includeSource?: boolean;
  projectRoot?: string;
  json?: boolean;
}

/**
 * Run a single `explore` query.
 *
 * @param db Graph database to search.
 * @param query Search term used to select graph nodes.
 * @param options Traversal, source, and output options.
 * @returns Structured text or JSON output with the process exit code.
 */
export function runExplore(
  db: Database,
  query: string,
  options: ExploreOptions = {}
): ExploreResult {
  const projectRoot = options.projectRoot ?? getProjectRoot(db);
  const limit = options.limit ?? OutputLimits.matches;
  const depth = options.depth ?? 1;
  const includeSource = options.includeSource ?? false;

  const searchResults = searchNodes(db, query);

  // Truncate matches to limit and cap at the first 50 before the
  // top-level `OutputLimits.matches` cap is applied.
  const truncated = searchResults.length > limit;
  const matches = searchResults.slice(0, limit);

  // Collect relationships and source snippets for the matched nodes.
  const relationships: RelationshipEntry[] = [];
  const sourceSnippets: SourceSnippet[] = [];
  if (matches.length > 0) {
    const fanout = OutputLimits.relationshipFanout;
    for (const m of matches) {
      const rels = expandRelationships(db, m.id, depth, fanout);
      for (const r of rels) relationships.push(r);
      if (includeSource) {
        const snippet = buildSnippet(db, m, projectRoot);
        if (snippet) sourceSnippets.push(snippet);
      }
    }
  }

  // Build freshness block. Always included (even when no project root)
  // so the JSON shape is stable.
  const freshness = buildFreshnessBlock(db, projectRoot);

  const output: ExploreOutput = {
    query,
    matches: matches.map((m) => ({
      id: m.id,
      type: m.type as NodeType,
      name: m.name,
      filePath: projectRoot ? toRelativePath(m.filePath, projectRoot) : m.filePath,
      summary: m.summary,
    })),
    relationships: relationships.map((r) => ({ ...r })),
    sourceSnippets,
    freshness,
    truncated,
  };

  if (options.json) {
    return {
      output: JSON.stringify(output),
      exitCode: ExitCode.Success,
    };
  }

  return {
    output: formatExploreText(output),
    exitCode: ExitCode.Success,
  };
}

/**
 * Build compact human-readable explore output.
 *
 * @param result Structured explore output.
 * @returns Formatted command output.
 */
export function formatExploreText(result: ExploreOutput): string {
  const lines: string[] = [];
  lines.push(`Explore: ${result.query}`);
  lines.push("");

  if (result.matches.length === 0) {
    lines.push("(no matches)");
    if (result.freshness.stale.length > 0) {
      lines.push("");
      lines.push("Stale files (re-scan recommended):");
      for (const s of result.freshness.stale) lines.push(`  ${s}`);
    }
    return lines.join("\n");
  }

  lines.push(`Matches (${result.matches.length}${result.truncated ? ", truncated" : ""}):`);
  for (const m of result.matches) {
    lines.push(`  ${m.type}:${m.name}  ${m.filePath}`);
    if (m.summary) lines.push(`    ${m.summary}`);
  }

  if (result.relationships.length > 0) {
    lines.push("");
    lines.push(`Relationships (${result.relationships.length}):`);
    for (const r of result.relationships) {
      lines.push(`  ${r.edgeType} → ${r.targetName}  ${r.targetFilePath}`);
    }
  }

  if (result.sourceSnippets.length > 0) {
    lines.push("");
    lines.push("Source snippets:");
    for (const s of result.sourceSnippets) {
      lines.push(`  ${s.filePath}:${s.lineStart}-${s.lineEnd}`);
      for (const line of s.content.split("\n")) {
        lines.push(`    ${line}`);
      }
    }
  }

  if (result.freshness.stale.length > 0) {
    lines.push("");
    lines.push("Stale files (re-scan recommended):");
    for (const s of result.freshness.stale) lines.push(`  ${s}`);
  }

  return lines.join("\n");
}

// ── Internal helpers ───────────────────────────────────────────────────────

function expandRelationships(
  db: Database,
  nodeId: string,
  depth: number,
  fanout: number
): RelationshipEntry[] {
  if (depth < 1) return [];
  const placeholders = IMPACT_TRAVERSAL_EDGE_TYPES.map(() => "?").join(",");
  // Outgoing edges
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
    .all(nodeId, ...IMPACT_TRAVERSAL_EDGE_TYPES, fanout) as Array<{
    edge_type: string;
    target_id: string;
    target_type: string;
    target_name: string;
    target_file_path: string;
  }>;
  // Incoming edges (callers / dependents)
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
    .all(nodeId, ...IMPACT_TRAVERSAL_EDGE_TYPES, fanout) as Array<{
    edge_type: string;
    source_id: string;
    source_type: string;
    source_name: string;
    source_file_path: string;
  }>;
  const results: RelationshipEntry[] = [];
  for (const o of outgoing) {
    results.push({
      sourceId: nodeId,
      targetId: o.target_id,
      edgeType: o.edge_type as RelationshipEntry["edgeType"],
      direction: "forward",
      targetName: o.target_name,
      targetFilePath: o.target_file_path,
      targetType: o.target_type as NodeType,
    });
  }
  for (const i of incoming) {
    results.push({
      sourceId: i.source_id,
      targetId: nodeId,
      edgeType: i.edge_type as RelationshipEntry["edgeType"],
      direction: "backward",
      targetName: i.source_name,
      targetFilePath: i.source_file_path,
      targetType: i.source_type as NodeType,
    });
  }
  return results;
}

/** Maximum file size (bytes) for source snippet extraction. Files
 * larger than this are skipped to prevent OOM on giant bundles or
 * generated files. */
const MAX_SNIPPET_FILE_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Build a bounded source excerpt for a persisted node.
 *
 * @param db Graph database containing the node.
 * @param match Persisted node identity and source location.
 * @param projectRoot Optional root used to relativize the source path.
 * @returns A bounded source snippet, or `null` when source is unavailable.
 */
export function buildSnippet(
  db: Database,
  match: { id: string; filePath: string; type: string; name: string },
  projectRoot?: string
): SourceSnippet | null {
  const meta = db
    .prepare("SELECT line_start, line_end FROM nodes WHERE id = ?")
    .get(match.id) as { line_start: number | null; line_end: number | null } | undefined;
  const filePath = projectRoot
    ? toAbsolute(match.filePath, projectRoot)
    : match.filePath;
  if (!filePath || !existsSync(filePath)) return null;
  // Reject files larger than MAX_SNIPPET_FILE_BYTES to avoid OOM.
  try {
    const stat = statSync(filePath);
    if (stat.size > MAX_SNIPPET_FILE_BYTES) return null;
  } catch {
    return null;
  }
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  const lines = content.split("\n");
  const start = meta?.line_start ?? 1;
  const end = meta?.line_end ?? start + OutputLimits.sourceSnippetLines - 1;
  const window = Math.min(OutputLimits.sourceSnippetLines, end - start + 1);
  const sliceStart = Math.max(0, start - 1);
  const sliceEnd = Math.min(lines.length, sliceStart + window);
  const snippetLines = lines.slice(sliceStart, sliceEnd);
  const truncated = sliceEnd - sliceStart < end - start + 1;
  return {
    nodeId: match.id,
    filePath: projectRoot ? toRelativePath(filePath, projectRoot) : filePath,
    lineStart: sliceStart + 1,
    lineEnd: sliceEnd,
    content: snippetLines.join("\n"),
    truncated,
  };
}

function toAbsolute(path: string, root: string): string {
  if (path.startsWith(root)) return path;
  // Strip leading "./" so we can append to root.
  const rel = path.startsWith("./") ? path.slice(2) : path;
  return `${root}/${rel}`;
}

function buildFreshnessBlock(db: Database, projectRoot?: string): FreshnessBlock {
  const stale = getStaleFiles(db);
  const rel = (p: string) => (projectRoot ? toRelativePath(p, projectRoot) : p);
  const checkedAt = getMetadata(db)?.lastIndexedAt ?? 0;
  return {
    stale: stale.map((s) => rel(s.path)).sort(),
    missing: stale.filter((s) => s.reason === "deleted").map((s) => rel(s.path)).sort(),
    checkedAt,
  };
}
