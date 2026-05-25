import { Database } from "bun:sqlite";
import { formatTable } from "./query";
import { toRelativePath } from "./paths";
import { getProjectRoot } from "./meta";
import { resolveNode, type ResolvedNode } from "./resolve";
import type { SearchResult } from "./contract";

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

// ── deps ───────────────────────────────────────────────────────────────────

export function runDeps(
  db: Database,
  name: string,
  downstream: boolean
): { output: string; exitCode: 0 | 2 } {
  const root = getProjectRoot(db);
  const resolved = resolveNode(db, name);

  if (resolved.kind === "none") {
    return { output: "(no matches)", exitCode: 0 };
  }

  if (resolved.kind === "ambiguous") {
    printDisambiguation(resolved.matches, root);
    return { output: "", exitCode: 2 };
  }

  const node = resolved.node;

  let rows: Array<{ type: string; name: string; file_path: string; edge_type: string }>;

  if (downstream) {
    // Who does this node depend on? (outgoing edges)
    rows = db.prepare(`
      SELECT n.type, n.name, n.file_path, e.type AS edge_type
      FROM edges e
      JOIN nodes n ON n.id = e.target
      WHERE e.source = ?
      ORDER BY n.type, n.name
    `).all(node.id) as typeof rows;
  } else {
    // Who depends on this node? (incoming edges)
    rows = db.prepare(`
      SELECT n.type, n.name, n.file_path, e.type AS edge_type
      FROM edges e
      JOIN nodes n ON n.id = e.source
      WHERE e.target = ?
      ORDER BY n.type, n.name
    `).all(node.id) as typeof rows;
  }

  if (rows.length === 0) {
    return { output: "(no results)", exitCode: 0 };
  }

  const columns = ["type", "name", "file_path", "edge_type"];
  const data = rows.map((r) => [r.type, r.name, rel(r.file_path, root), r.edge_type]);
  return { output: formatTable(columns, data), exitCode: 0 };
}

// ── callers ────────────────────────────────────────────────────────────────

export function runCallers(db: Database, name: string): { output: string; exitCode: 0 | 2 } {
  const root = getProjectRoot(db);
  const resolved = resolveNode(db, name);

  if (resolved.kind === "none") {
    return { output: "(no matches)", exitCode: 0 };
  }

  if (resolved.kind === "ambiguous") {
    printDisambiguation(resolved.matches, root);
    return { output: "", exitCode: 2 };
  }

  const node = resolved.node;

  // Find edges where target is this node and source is a function or file
  const rows = db.prepare(`
    SELECT n.type, n.name, n.file_path, e.type AS edge_type
    FROM edges e
    JOIN nodes n ON n.id = e.source
    WHERE e.target = ? AND (n.type = 'function' OR n.type = 'file')
      AND e.type IN ('calls', 'imports', 'depends_on')
    ORDER BY n.type, n.name
  `).all(node.id) as Array<{ type: string; name: string; file_path: string; edge_type: string }>;

  if (rows.length === 0) {
    return { output: "(no results)", exitCode: 0 };
  }

  const columns = ["type", "name", "file_path", "edge_type"];
  const data = rows.map((r) => [r.type, r.name, rel(r.file_path, root), r.edge_type]);
  return { output: formatTable(columns, data), exitCode: 0 };
}

// ── path ───────────────────────────────────────────────────────────────────

export function runPath(
  db: Database,
  fromName: string,
  toName: string
): { output: string; exitCode: 0 | 2 } {
  const root = getProjectRoot(db);
  const fromResolved = resolveNode(db, fromName);
  const toResolved = resolveNode(db, toName);

  if (fromResolved.kind === "ambiguous") {
    console.error(`Ambiguous source '${fromName}':`);
    printDisambiguation(fromResolved.matches, root);
    return { output: "", exitCode: 2 };
  }

  if (toResolved.kind === "ambiguous") {
    console.error(`Ambiguous target '${toName}':`);
    printDisambiguation(toResolved.matches, root);
    return { output: "", exitCode: 2 };
  }

  if (fromResolved.kind === "none" || toResolved.kind === "none") {
    return { output: "(no matches)", exitCode: 0 };
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
    return { output: "(no path found)", exitCode: 0 };
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
  return { output: readablePath, exitCode: 0 };
}

// ── stats ──────────────────────────────────────────────────────────────────

export function runStats(db: Database): string {
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

  // Package breakdown: first directory segment after root
  const packages = db.prepare(`
    SELECT DISTINCT file_path FROM nodes WHERE type = 'file'
  `).all() as Array<{ file_path: string }>;

  const pkgCounts = new Map<string, number>();
  for (const { file_path } of packages) {
    const rel = root ? toRelativePath(file_path, root) : file_path;
    const parts = rel.split("/");
    const pkg = parts[0] === "." ? (parts[1] ?? "root") : (parts[0] ?? "root");
    pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
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

// ── files ──────────────────────────────────────────────────────────────────

export function runFiles(db: Database, pattern?: string): string {
  const root = getProjectRoot(db);

  const whereClause = pattern ? "WHERE file_path LIKE ? ESCAPE '\\'" : "";
  const params = pattern ? [`%${pattern.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`] : [];

  const rows = db.prepare(`
    SELECT
      name,
      file_path,
      SUM(CASE WHEN type = 'function' THEN 1 ELSE 0 END) AS functions,
      SUM(CASE WHEN type = 'class' THEN 1 ELSE 0 END) AS classes,
      SUM(CASE WHEN type = 'interface' THEN 1 ELSE 0 END) AS interfaces,
      SUM(CASE WHEN type = 'type_alias' THEN 1 ELSE 0 END) AS type_aliases
    FROM nodes
    ${whereClause}
    GROUP BY file_path
    ORDER BY file_path
  `).all(...params) as Array<{
    name: string;
    file_path: string;
    functions: number;
    classes: number;
    interfaces: number;
    type_aliases: number;
  }>;

  // Filter to only rows that are file nodes (they have the file name as name)
  // Actually the GROUP BY approach groups by file_path, but name will be from one row.
  // Better: query file nodes specifically
  const fileRows = db.prepare(`
    SELECT id, name, file_path
    FROM nodes
    WHERE type = 'file'
    ${pattern ? "AND file_path LIKE ? ESCAPE '\\'" : ""}
    ORDER BY file_path
  `).all(...(pattern ? [`%${pattern.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`] : [])) as Array<{ id: string; name: string; file_path: string }>;

  const columns = ["name", "path", "functions", "classes", "interfaces", "type_aliases"];
  const data = fileRows.map((f) => {
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN type = 'function' THEN 1 ELSE 0 END) AS functions,
        SUM(CASE WHEN type = 'class' THEN 1 ELSE 0 END) AS classes,
        SUM(CASE WHEN type = 'interface' THEN 1 ELSE 0 END) AS interfaces,
        SUM(CASE WHEN type = 'type_alias' THEN 1 ELSE 0 END) AS type_aliases
      FROM nodes
      WHERE file_path = ? AND type != 'file'
    `).get(f.file_path) as {
      functions: number | null;
      classes: number | null;
      interfaces: number | null;
      type_aliases: number | null;
    };

    return [
      f.name,
      rel(f.file_path, root),
      counts.functions ?? 0,
      counts.classes ?? 0,
      counts.interfaces ?? 0,
      counts.type_aliases ?? 0,
    ];
  });

  return formatTable(columns, data);
}
