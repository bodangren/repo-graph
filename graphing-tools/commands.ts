import { Database } from "bun:sqlite";
import { formatTable } from "./query";
import { toRelativePath } from "./paths";
import { getMetadata, getProjectRoot, getStaleFiles } from "./meta";
import { resolveNode, type ResolvedNode } from "./resolve";
import { ExitCode, type ExitCodeValue, type SearchResult, type FreshnessBlock, type NodeDocumentation } from "./contract";

// ── Shared formatting ──────────────────────────────────────────────────────

function rel(path: string, root: string | undefined): string {
  return root ? toRelativePath(path, root) : path;
}

function printDisambiguation(matches: SearchResult[], root: string | undefined): void {
  console.error("Ambiguous name — multiple nodes match:");
  const columns = ["type", "name", "file_path"];
  const rows = matches.map((m) => [m.type, m.name, rel(m.filePath, root)]);
  console.error(formatTable(columns, rows));
}

/**
 * Build a `FreshnessBlock` for JSON output, scoped to a set of
 * optional `watchPaths`. When `watchPaths` is provided, only files
 * matching those paths are surfaced (others are ignored).
 *
 * @param db Graph database containing stored file records.
 * @param watchPaths Optional paths to include.
 * @returns Deterministic freshness state.
 */
function buildFreshnessBlock(db: Database, watchPaths?: string[]): FreshnessBlock {
  const stale = getStaleFiles(db);
  const watchSet = watchPaths && watchPaths.length > 0 ? new Set(watchPaths) : null;
  const stalePaths = stale
    .filter((s) => !watchSet || watchSet.has(s.path))
    .map((s) => s.path);
  const missingPaths = stale
    .filter((s) => s.reason === "deleted" && (!watchSet || watchSet.has(s.path)))
    .map((s) => s.path);
  return {
    stale: stalePaths,
    missing: missingPaths,
    checkedAt: getMetadata(db)?.lastIndexedAt ?? 0,
  };
}

// ── deps ───────────────────────────────────────────────────────────────────

/**
 * List direct or transitive dependencies of a resolved node.
 *
 * @param db Graph database to query.
 * @param name Node id or name to resolve.
 * @param downstream Whether to follow outgoing dependency edges.
 * @param opts Traversal, package-filter, and output options.
 * @returns Serialized results and the process exit code.
 */
export function runDeps(
  db: Database,
  name: string,
  downstream: boolean,
  opts?: { json?: boolean; limit?: number; depth?: number; fromPackage?: string; toPackage?: string }
): { output: string; exitCode: ExitCodeValue } {
  const root = getProjectRoot(db);
  const resolved = resolveNode(db, name);

  if (resolved.kind === "none") {
    if (opts?.json) return { output: JSON.stringify({ results: [] }), exitCode: ExitCode.NotFound };
    return { output: "(no matches)", exitCode: ExitCode.NotFound };
  }

  if (resolved.kind === "ambiguous") {
    printDisambiguation(resolved.matches, root);
    return { output: "", exitCode: ExitCode.Ambiguous };
  }

  const node = resolved.node;
  const depth = opts?.depth ?? 1;
  const limit = opts?.limit ?? 0;
  const fromPackage = opts?.fromPackage;
  const toPackage = opts?.toPackage;

  let rows: Array<{ type: string; name: string; file_path: string; edge_type: string; depth: number }>;

  if (depth > 1) {
    const sql = downstream
      ? `
        WITH RECURSIVE traverse(id, type, name, file_path, edge_type, hops, path) AS (
          SELECT n.id, n.type, n.name, n.file_path, e.type AS edge_type, 1,
                 e.source || ' → ' || e.target
          FROM edges e
          JOIN nodes n ON n.id = e.target
          JOIN nodes ns ON ns.id = e.source
          WHERE e.source = ?
            AND (?2 IS NULL OR ns.package_id = ?2)
            AND (?3 IS NULL OR n.package_id = ?3)

          UNION ALL

          SELECT n.id, n.type, n.name, n.file_path, e.type AS edge_type, t.hops + 1,
                 t.path || ' → ' || e.target
          FROM edges e
          JOIN nodes n ON n.id = e.target
          JOIN nodes ns ON ns.id = e.source
          JOIN traverse t ON e.source = t.id
          WHERE t.hops < ?
            AND (?2 IS NULL OR ns.package_id = ?2)
            AND (?3 IS NULL OR n.package_id = ?3)
            AND INSTR(' → ' || t.path || ' → ', ' → ' || e.target || ' → ') = 0
        )
        SELECT id, type, name, file_path, edge_type, hops AS depth
        FROM traverse
        ORDER BY hops, name
      `
      : `
        WITH RECURSIVE traverse(id, type, name, file_path, edge_type, hops, path) AS (
          SELECT n.id, n.type, n.name, n.file_path, e.type AS edge_type, 1,
                 e.source || ' → ' || e.target
          FROM edges e
          JOIN nodes n ON n.id = e.source
          JOIN nodes nt ON nt.id = e.target
          WHERE e.target = ?
            AND (?2 IS NULL OR n.package_id = ?2)
            AND (?3 IS NULL OR nt.package_id = ?3)

          UNION ALL

          SELECT n.id, n.type, n.name, n.file_path, e.type AS edge_type, t.hops + 1,
                 t.path || ' → ' || e.target
          FROM edges e
          JOIN nodes n ON n.id = e.source
          JOIN nodes nt ON nt.id = e.target
          JOIN traverse t ON e.target = t.id
          WHERE t.hops < ?
            AND (?2 IS NULL OR n.package_id = ?2)
            AND (?3 IS NULL OR nt.package_id = ?3)
            AND INSTR(' → ' || t.path || ' → ', ' → ' || e.source || ' → ') = 0
        )
        SELECT id, type, name, file_path, edge_type, hops AS depth
        FROM traverse
        ORDER BY hops, name
      `;
    rows = db.prepare(sql).all(node.id, fromPackage ?? null, toPackage ?? null, depth) as typeof rows;
  } else {
    const sql = downstream
      ? `
        SELECT n.type, n.name, n.file_path, e.type AS edge_type, 1 AS depth
        FROM edges e
        JOIN nodes n ON n.id = e.target
        JOIN nodes ns ON ns.id = e.source
        WHERE e.source = ?
          AND (?2 IS NULL OR ns.package_id = ?2)
          AND (?3 IS NULL OR n.package_id = ?3)
        ORDER BY n.type, n.name
      `
      : `
        SELECT n.type, n.name, n.file_path, e.type AS edge_type, 1 AS depth
        FROM edges e
        JOIN nodes n ON n.id = e.source
        JOIN nodes nt ON nt.id = e.target
        WHERE e.target = ?
          AND (?2 IS NULL OR n.package_id = ?2)
          AND (?3 IS NULL OR nt.package_id = ?3)
        ORDER BY n.type, n.name
      `;
    rows = db.prepare(sql).all(node.id, fromPackage ?? null, toPackage ?? null) as typeof rows;
  }

  if (rows.length === 0) {
    if (opts?.json) return { output: JSON.stringify({ results: [] }), exitCode: ExitCode.NotFound };
    return { output: "(no results)", exitCode: ExitCode.NotFound };
  }

  const total = rows.length;
  const truncated = limit > 0 && rows.length > limit;
  if (truncated) rows = rows.slice(0, limit);

  if (opts?.json) {
    const payload: Record<string, unknown> = {
      node: { id: node.id, type: node.type, name: node.name, file_path: node.filePath },
      results: rows.map((r) => ({
        type: r.type,
        name: r.name,
        file_path: rel(r.file_path, root),
        edge_type: r.edge_type,
        depth: r.depth,
      })),
    };
    if (truncated) {
      payload.truncated = true;
      payload.total = total;
    }
    return { output: JSON.stringify(payload), exitCode: ExitCode.Success };
  }

  const columns = ["type", "name", "file_path", "edge_type"];
  if (depth > 1) columns.push("depth");
  const data = rows.map((r) => {
    const row = [r.type, r.name, rel(r.file_path, root), r.edge_type];
    if (depth > 1) row.push(String(r.depth));
    return row;
  });
  let output = formatTable(columns, data);
  if (truncated) output += `\n… and ${total - limit} more (use --limit to raise cap, default 100)`;
  return { output, exitCode: ExitCode.Success };
}

// ── callers ────────────────────────────────────────────────────────────────

/**
 * List functions and files that call or depend on a resolved node.
 *
 * @param db Graph database to query.
 * @param name Node id or name to resolve.
 * @param opts Traversal, package-filter, and output options.
 * @returns Serialized results and the process exit code.
 */
export function runCallers(
  db: Database,
  name: string,
  opts?: { json?: boolean; limit?: number; depth?: number; fromPackage?: string; toPackage?: string }
): { output: string; exitCode: ExitCodeValue } {
  const root = getProjectRoot(db);
  const resolved = resolveNode(db, name);

  if (resolved.kind === "none") {
    if (opts?.json) return { output: JSON.stringify({ results: [] }), exitCode: ExitCode.NotFound };
    return { output: "(no matches)", exitCode: ExitCode.NotFound };
  }

  if (resolved.kind === "ambiguous") {
    printDisambiguation(resolved.matches, root);
    return { output: "", exitCode: ExitCode.Ambiguous };
  }

  const node = resolved.node;
  const depth = opts?.depth ?? 1;
  const limit = opts?.limit ?? 0;
  const fromPackage = opts?.fromPackage;
  const toPackage = opts?.toPackage;

  let rows: Array<{ type: string; name: string; file_path: string; edge_type: string; depth: number }>;

  if (depth > 1) {
    rows = db.prepare(`
      WITH RECURSIVE traverse(id, type, name, file_path, edge_type, hops, path) AS (
        SELECT n.id, n.type, n.name, n.file_path, e.type AS edge_type, 1,
               e.source || ' → ' || e.target
        FROM edges e
        JOIN nodes n ON n.id = e.source
        JOIN nodes nt ON nt.id = e.target
        WHERE e.target = ? AND (n.type = 'function' OR n.type = 'file')
          AND e.type IN ('calls', 'imports', 'depends_on')
          AND (?2 IS NULL OR n.package_id = ?2)
          AND (?3 IS NULL OR nt.package_id = ?3)

        UNION ALL

        SELECT n.id, n.type, n.name, n.file_path, e.type AS edge_type, t.hops + 1,
               t.path || ' → ' || e.source
        FROM edges e
        JOIN nodes n ON n.id = e.source
        JOIN nodes nt ON nt.id = e.target
        JOIN traverse t ON e.target = t.id
        WHERE t.hops < ?
          AND INSTR(' → ' || t.path || ' → ', ' → ' || e.source || ' → ') = 0
          AND e.type IN ('calls', 'imports', 'depends_on')
          AND (?2 IS NULL OR n.package_id = ?2)
          AND (?3 IS NULL OR nt.package_id = ?3)
      )
      SELECT id, type, name, file_path, edge_type, hops AS depth
      FROM traverse
      ORDER BY hops, name
    `).all(node.id, fromPackage ?? null, toPackage ?? null, depth) as typeof rows;
  } else {
    rows = db.prepare(`
      SELECT n.type, n.name, n.file_path, e.type AS edge_type, 1 AS depth
      FROM edges e
      JOIN nodes n ON n.id = e.source
      JOIN nodes nt ON nt.id = e.target
      WHERE e.target = ? AND (n.type = 'function' OR n.type = 'file')
        AND e.type IN ('calls', 'imports', 'depends_on')
        AND (?2 IS NULL OR n.package_id = ?2)
        AND (?3 IS NULL OR nt.package_id = ?3)
      ORDER BY n.type, n.name
    `).all(node.id, fromPackage ?? null, toPackage ?? null) as typeof rows;
  }

  if (rows.length === 0) {
    if (opts?.json) return { output: JSON.stringify({ results: [] }), exitCode: ExitCode.NotFound };
    return { output: "(no results)", exitCode: ExitCode.NotFound };
  }

  const total = rows.length;
  const truncated = limit > 0 && rows.length > limit;
  if (truncated) rows = rows.slice(0, limit);

  if (opts?.json) {
    const payload: Record<string, unknown> = {
      node: { id: node.id, type: node.type, name: node.name, file_path: node.filePath },
      results: rows.map((r) => ({
        type: r.type,
        name: r.name,
        file_path: rel(r.file_path, root),
        edge_type: r.edge_type,
        depth: r.depth,
      })),
    };
    if (truncated) {
      payload.truncated = true;
      payload.total = total;
    }
    return { output: JSON.stringify(payload), exitCode: ExitCode.Success };
  }

  const columns = ["type", "name", "file_path", "edge_type"];
  if (depth > 1) columns.push("depth");
  const data = rows.map((r) => {
    const row = [r.type, r.name, rel(r.file_path, root), r.edge_type];
    if (depth > 1) row.push(String(r.depth));
    return row;
  });
  let output = formatTable(columns, data);
  if (truncated) output += `\n… and ${total - limit} more (use --limit to raise cap, default 100)`;
  return { output, exitCode: ExitCode.Success };
}

// ── path ───────────────────────────────────────────────────────────────────

/**
 * Find a dependency path between two resolved nodes.
 *
 * @param db Graph database to query.
 * @param fromName Starting node id or name.
 * @param toName Destination node id or name.
 * @param opts Output options.
 * @returns Serialized path output and the process exit code.
 */
export function runPath(
  db: Database,
  fromName: string,
  toName: string,
  opts?: { json?: boolean }
): { output: string; exitCode: ExitCodeValue } {
  const root = getProjectRoot(db);
  const fromResolved = resolveNode(db, fromName);
  const toResolved = resolveNode(db, toName);

  if (fromResolved.kind === "ambiguous") {
    console.error(`Ambiguous source '${fromName}':`);
    printDisambiguation(fromResolved.matches, root);
    return { output: "", exitCode: ExitCode.Ambiguous };
  }

  if (toResolved.kind === "ambiguous") {
    console.error(`Ambiguous target '${toName}':`);
    printDisambiguation(toResolved.matches, root);
    return { output: "", exitCode: ExitCode.Ambiguous };
  }

  if (fromResolved.kind === "none" || toResolved.kind === "none") {
    if (opts?.json) return { output: JSON.stringify({ found: false }), exitCode: ExitCode.NotFound };
    return { output: "(no matches)", exitCode: ExitCode.NotFound };
  }

  const fromNode = fromResolved.node;
  const toNode = toResolved.node;

  // Shortest path via recursive CTE
  const rows = db.prepare(`
    WITH RECURSIVE path_cte(source_id, target_id, path, hops) AS (
      SELECT source, target,
             source || ' → ' || target,
             1
      FROM edges
      WHERE source = ?

      UNION ALL

      SELECT e.source, e.target,
             p.path || ' → ' || e.target,
             p.hops + 1
      FROM edges e
      JOIN path_cte p ON e.source = p.target_id
      WHERE p.hops < 20
        AND INSTR(' → ' || p.path || ' → ', ' → ' || e.target || ' → ') = 0
    )
    SELECT path, hops FROM path_cte WHERE target_id = ? ORDER BY hops LIMIT 1
  `).all(fromNode.id, toNode.id) as Array<{ path: string; hops: number }>;

  if (rows.length === 0) {
    if (opts?.json) return { output: JSON.stringify({ found: false }), exitCode: ExitCode.NotFound };
    return { output: "(no path found)", exitCode: ExitCode.NotFound };
  }

  // Replace IDs with human-readable names
  const path = rows[0].path;
  const idToName = new Map<string, string>();
  const ids = path.split(" → ");
  for (const id of ids) {
    const row = db.prepare("SELECT type, name FROM nodes WHERE id = ?").get(id) as
      | { type: string; name: string }
      | undefined;
    if (row) {
      idToName.set(id, `${row.type}:${row.name}`);
    } else {
      idToName.set(id, id);
    }
  }

  const readablePath = ids.map((id) => idToName.get(id) ?? id).join(" → ");

  if (opts?.json) {
    const pathObjects = ids.map((id) => {
      const row = db.prepare("SELECT id, type, name, file_path FROM nodes WHERE id = ?").get(id) as
        | { id: string; type: string; name: string; file_path: string }
        | undefined;
      if (row) {
        return { id: row.id, type: row.type, name: row.name, file_path: rel(row.file_path, root) };
      }
      return { id, type: "unknown", name: id, file_path: "" };
    });
    return {
      output: JSON.stringify({ found: true, hops: rows[0].hops, path: pathObjects }),
      exitCode: ExitCode.Success,
    };
  }

  return { output: readablePath, exitCode: ExitCode.Success };
}

// ── stats ──────────────────────────────────────────────────────────────────

/**
 * Summarize graph size, node types, edge types, and packages.
 *
 * @param db Graph database to inspect.
 * @param opts Output options.
 * @returns Human-readable or JSON statistics.
 */
export function runStats(db: Database, opts?: { json?: boolean }): string {
  const root = getProjectRoot(db);

  const totalNodes = (db.prepare("SELECT COUNT(*) AS c FROM nodes").get() as { c: number }).c;
  const totalEdges = (db.prepare("SELECT COUNT(*) AS c FROM edges").get() as { c: number }).c;
  const totalFiles = (db.prepare("SELECT COUNT(*) AS c FROM nodes WHERE type = 'file'").get() as { c: number }).c;

  const byType = db.prepare("SELECT type, COUNT(*) AS c FROM nodes GROUP BY type ORDER BY c DESC").all() as
    Array<{ type: string; c: number }>;

  const topImported = db.prepare(`
    SELECT n.name, n.type, COUNT(*) AS c
    FROM edges e
    JOIN nodes n ON n.id = e.target
    WHERE e.type = 'imports'
    GROUP BY e.target
    ORDER BY c DESC
    LIMIT 10
  `).all() as Array<{ name: string; type: string; c: number }>;

  const largestFiles = db.prepare(`
    SELECT file_path, COUNT(*) AS c
    FROM nodes
    WHERE type != 'file'
    GROUP BY file_path
    ORDER BY c DESC
    LIMIT 10
  `).all() as Array<{ file_path: string; c: number }>;

  // Package breakdown using package_id when available, falling back to first path segment
  const fileNodes = db.prepare(`
    SELECT file_path, package_id FROM nodes WHERE type = 'file'
  `).all() as Array<{ file_path: string; package_id: string | null }>;

  const pkgCounts = new Map<string, number>();
  for (const { file_path, package_id } of fileNodes) {
    let pkg: string;
    if (package_id) {
      pkg = package_id;
    } else {
      const relPath = root ? toRelativePath(file_path, root) : file_path;
      const parts = relPath.split("/");
      pkg = parts[0] === "." ? (parts[1] ?? "root") : (parts[0] ?? "root");
    }
    pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
  }

  if (opts?.json) {
    const payload: Record<string, unknown> = {
      totals: { nodes: totalNodes, edges: totalEdges, files: totalFiles },
      by_type: byType,
      top_imported: topImported,
      largest_files: largestFiles.map((r) => ({ file_path: rel(r.file_path, root), entities: r.c })),
      packages: Object.fromEntries(pkgCounts),
    };
    if (root) {
      payload.freshness = buildFreshnessBlock(db);
    }
    return JSON.stringify(payload);
  }

  const lines: string[] = [];
  lines.push("Graph Statistics");
  lines.push("================");
  lines.push(`Total nodes: ${totalNodes}`);
  lines.push(`Total edges: ${totalEdges}`);
  lines.push(`Total files: ${totalFiles}`);
  lines.push("");

  // ASCII bar chart
  lines.push("Nodes by type:");
  const maxTypeLen = Math.max(...byType.map((t) => t.type.length), 4);
  const maxCount = Math.max(...byType.map((t) => t.c), 1);
  const barWidth = 40;
  for (const { type, c } of byType) {
    const barLen = Math.round((c / maxCount) * barWidth);
    const bar = "█".repeat(barLen);
    lines.push(`  ${type.padEnd(maxTypeLen)} ${String(c).padStart(4)} ${bar}`);
  }
  lines.push("");

  lines.push("Top 10 most imported:");
  for (const row of topImported) {
    lines.push(`  ${row.type}:${row.name} (${row.c} imports)`);
  }
  if (topImported.length === 0) lines.push("  (none)");
  lines.push("");

  lines.push("Top 10 largest files (by entity count):");
  for (const row of largestFiles) {
    lines.push(`  ${rel(row.file_path, root)} (${row.c} entities)`);
  }
  if (largestFiles.length === 0) lines.push("  (none)");
  lines.push("");

  lines.push("Package breakdown:");
  const sortedPkgs = Array.from(pkgCounts.entries()).sort((a, b) => b[1] - a[1]);
  for (const [pkg, c] of sortedPkgs) {
    lines.push(`  ${pkg}: ${c} files`);
  }

  return lines.join("\n");
}

// ── inspect ────────────────────────────────────────────────────────────────

/**
 * Inspect a resolved node, its documentation, and direct relationships.
 *
 * @param db Graph database to inspect.
 * @param name Node id or name to resolve.
 * @param opts Output options.
 * @returns Serialized inspection output and the process exit code.
 */
export function runInspect(
  db: Database,
  name: string,
  opts?: { json?: boolean }
): { output: string; exitCode: ExitCodeValue } {
  const root = getProjectRoot(db);
  const resolved = resolveNode(db, name);

  if (resolved.kind === "none") {
    if (opts?.json) return { output: JSON.stringify({ node: null }), exitCode: ExitCode.NotFound };
    return { output: "(no matches)", exitCode: ExitCode.NotFound };
  }

  if (resolved.kind === "ambiguous") {
    printDisambiguation(resolved.matches, root);
    return { output: "", exitCode: ExitCode.Ambiguous };
  }

  const node = resolved.node;
  const meta = db.prepare("SELECT line_start, line_end, summary, documentation, tags FROM nodes WHERE id = ?").get(node.id) as
    | { line_start: number | null; line_end: number | null; summary: string | null; documentation: string | null; tags: string | null }
    | undefined;

  const outgoing = db.prepare(`
    SELECT e.type, e.target, n.type AS target_type, n.name AS target_name, n.tags AS target_tags
    FROM edges e
    JOIN nodes n ON n.id = e.target
    WHERE e.source = ?
    ORDER BY e.type, n.name
  `).all(node.id) as Array<{ type: string; target: string; target_type: string; target_name: string; target_tags: string | null }>;

  const incoming = db.prepare(`
    SELECT e.type, e.source, n.type AS source_type, n.name AS source_name, n.tags AS source_tags
    FROM edges e
    JOIN nodes n ON n.id = e.source
    WHERE e.target = ?
    ORDER BY e.type, n.name
  `).all(node.id) as Array<{ type: string; source: string; source_type: string; source_name: string; source_tags: string | null }>;

  const unresolvedOutgoing = outgoing.filter((e) => {
    try {
      return e.target_tags && JSON.parse(e.target_tags).includes("unresolved");
    } catch {
      return false;
    }
  });
  const resolvedOutgoing = outgoing.filter((e) => !unresolvedOutgoing.includes(e));

  if (opts?.json) {
    const payload: Record<string, unknown> = {
      node: {
        id: node.id,
        type: node.type,
        name: node.name,
        file_path: rel(node.filePath, root),
        line_start: meta?.line_start ?? undefined,
        line_end: meta?.line_end ?? undefined,
        summary: meta?.summary ?? undefined,
        documentation: parseDocumentation(meta?.documentation),
        tags: meta?.tags ? JSON.parse(meta.tags) : undefined,
      },
      outgoing: resolvedOutgoing.map((r) => ({
        type: r.type,
        target_id: r.target,
        target_name: r.target_name,
        target_type: r.target_type,
      })),
      incoming: incoming.map((r) => ({
        type: r.type,
        source_id: r.source,
        source_name: r.source_name,
        source_type: r.source_type,
      })),
      unresolved: unresolvedOutgoing.map((r) => ({
        type: r.type,
        target_id: r.target,
        target_name: r.target_name,
        target_type: r.target_type,
      })),
    };
    if (root) {
      payload.freshness = buildFreshnessBlock(db, [node.filePath]);
    }
    return {
      output: JSON.stringify(payload),
      exitCode: ExitCode.Success,
    };
  }

  const lines: string[] = [];
  const location = meta?.line_start ? ` (${rel(node.filePath, root)}:${meta.line_start}${meta.line_end ? `–${meta.line_end}` : ""})` : "";
  lines.push(`${node.type}:${node.name}${location}`);
  if (meta?.tags) lines.push(`Tags: ${meta.tags}`);
  if (meta?.summary) lines.push(`Summary: ${meta.summary}`);
  const documentation = parseDocumentation(meta?.documentation);
  if (documentation) {
    lines.push(`Documentation: ${documentation.description || "(no description)"}`);
    if (documentation.params.length > 0) lines.push(`Documented params: ${documentation.params.map((param) => param.name).join(", ")}`);
    if (documentation.returns) lines.push(`Returns: ${documentation.returns}`);
  }
  lines.push("");

  lines.push(`Outgoing edges (${resolvedOutgoing.length}):`);
  for (const e of resolvedOutgoing) {
    lines.push(`  ${e.type} → ${e.target_type}:${e.target_name}`);
  }
  if (resolvedOutgoing.length === 0) lines.push("  (none)");
  lines.push("");

  lines.push(`Incoming edges (${incoming.length}):`);
  for (const e of incoming) {
    lines.push(`  ${e.type} ← ${e.source_type}:${e.source_name}`);
  }
  if (incoming.length === 0) lines.push("  (none)");
  lines.push("");

  if (unresolvedOutgoing.length > 0) {
    lines.push(`Unresolved edges (${unresolvedOutgoing.length}):`);
    for (const e of unresolvedOutgoing) {
      lines.push(`  ${e.type} → ${e.target_type}:${e.target_name}`);
    }
  }

  return { output: lines.join("\n"), exitCode: ExitCode.Success };
}

function parseDocumentation(raw: string | null | undefined): NodeDocumentation | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as NodeDocumentation;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ── files ──────────────────────────────────────────────────────────────────

/**
 * List graph file nodes and their entity counts.
 *
 * @param db Graph database to inspect.
 * @param pattern Optional path pattern.
 * @param opts Output and result-limit options.
 * @returns Human-readable or JSON file listing.
 */
export function runFiles(db: Database, pattern?: string, opts?: { json?: boolean; limit?: number }): string {
  const root = getProjectRoot(db);

  const whereClause = pattern ? "AND n.file_path LIKE ? ESCAPE '\\'" : "";
  const params = pattern ? [`%${pattern.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`] : [];

  const limit = opts?.limit ?? 0;
  const limitClause = limit > 0 ? `LIMIT ${limit + 1}` : "";

  const rows = db.prepare(`
    SELECT n.name, n.file_path,
           SUM(CASE WHEN n2.type = 'function'   THEN 1 ELSE 0 END) AS functions,
           SUM(CASE WHEN n2.type = 'class'      THEN 1 ELSE 0 END) AS classes,
           SUM(CASE WHEN n2.type = 'interface'  THEN 1 ELSE 0 END) AS interfaces,
           SUM(CASE WHEN n2.type = 'type_alias' THEN 1 ELSE 0 END) AS type_aliases
    FROM nodes n
    LEFT JOIN nodes n2 ON n2.file_path = n.file_path AND n2.type != 'file'
    WHERE n.type = 'file'
    ${whereClause}
    GROUP BY n.file_path
    ORDER BY n.file_path
    ${limitClause}
  `).all(...params) as Array<{
    name: string;
    file_path: string;
    functions: number;
    classes: number;
    interfaces: number;
    type_aliases: number;
  }>;

  const truncated = limit > 0 && rows.length > limit;
  const total = rows.length;
  const displayRows = truncated ? rows.slice(0, limit) : rows;

  if (opts?.json) {
    const payload = displayRows.map((r) => ({
      name: r.name,
      path: rel(r.file_path, root),
      functions: r.functions ?? 0,
      classes: r.classes ?? 0,
      interfaces: r.interfaces ?? 0,
      type_aliases: r.type_aliases ?? 0,
    }));
    if (truncated) {
      return JSON.stringify({ results: payload, truncated: true, total });
    }
    return JSON.stringify(payload);
  }

  const columns = ["name", "path", "functions", "classes", "interfaces", "type_aliases"];
  const data = displayRows.map((r) => [
    r.name,
    rel(r.file_path, root),
    r.functions ?? 0,
    r.classes ?? 0,
    r.interfaces ?? 0,
    r.type_aliases ?? 0,
  ]);

  let output = formatTable(columns, data);
  if (truncated) output += `\n… and ${total - limit} more (use --limit to raise cap, default 100)`;
  return output;
}
