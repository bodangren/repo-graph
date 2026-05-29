import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { formatTable } from "./query";
import { ExitCode } from "./contract";

export interface AuditResult {
  missingFiles: Array<{ id: string; type: string; name: string; file_path: string }>;
  staleSymbols: Array<{ id: string; type: string; name: string; file_path: string; line_start: number | null }>;
  orphanEdges: Array<{ source: string; target: string; type: string; missingSide: "source" | "target" | "both" }>;
  duplicateNodes: Array<{ name: string; type: string; file_path: string; ids: string[]; count: number }>;
}

function findMissingFiles(db: Database): AuditResult["missingFiles"] {
  const rows = db.prepare("SELECT id, type, name, file_path FROM nodes WHERE type = 'file'").all() as
    Array<{ id: string; type: string; name: string; file_path: string }>;
  return rows.filter((r) => !existsSync(r.file_path));
}

function findOrphanEdges(db: Database): AuditResult["orphanEdges"] {
  const rows = db.prepare(`
    SELECT e.source, e.target, e.type,
           CASE WHEN ns.id IS NULL AND nt.id IS NULL THEN 'both'
                WHEN ns.id IS NULL THEN 'source'
                ELSE 'target' END AS missingSide
    FROM edges e
    LEFT JOIN nodes ns ON ns.id = e.source
    LEFT JOIN nodes nt ON nt.id = e.target
    WHERE ns.id IS NULL OR nt.id IS NULL
  `).all() as Array<{ source: string; target: string; type: string; missingSide: "source" | "target" | "both" }>;
  return rows;
}

function findDuplicateNodes(db: Database): AuditResult["duplicateNodes"] {
  const rows = db.prepare(`
    SELECT name, type, file_path, COUNT(*) AS c, GROUP_CONCAT(id) AS ids
    FROM nodes
    GROUP BY name, type, file_path
    HAVING c > 1
  `).all() as Array<{ name: string; type: string; file_path: string; c: number; ids: string }>;
  return rows.map((r) => ({
    name: r.name,
    type: r.type,
    file_path: r.file_path,
    ids: r.ids.split(","),
    count: r.c,
  }));
}

export function runAudit(
  db: Database,
  opts?: { json?: boolean }
): { output: string; exitCode: ExitCode.Success | ExitCode.NotFound } {
  const result: AuditResult = {
    missingFiles: findMissingFiles(db),
    staleSymbols: [],
    orphanEdges: findOrphanEdges(db),
    duplicateNodes: findDuplicateNodes(db),
  };

  const hasIssues =
    result.missingFiles.length > 0 ||
    result.staleSymbols.length > 0 ||
    result.orphanEdges.length > 0 ||
    result.duplicateNodes.length > 0;

  if (opts?.json) {
    return {
      output: JSON.stringify(result),
      exitCode: hasIssues ? ExitCode.NotFound : ExitCode.Success,
    };
  }

  if (!hasIssues) {
    return {
      output: "Audit complete. No issues found.",
      exitCode: ExitCode.Success,
    };
  }

  const lines: string[] = [];
  lines.push("Audit Results");
  lines.push("=============");
  lines.push("");

  if (result.missingFiles.length > 0) {
    lines.push(`missing_files (${result.missingFiles.length}):`);
    const columns = ["type", "name", "file_path"];
    const rows = result.missingFiles.map((r) => [r.type, r.name, r.file_path]);
    lines.push(formatTable(columns, rows));
    lines.push("");
  }

  if (result.orphanEdges.length > 0) {
    lines.push(`orphan_edges (${result.orphanEdges.length}):`);
    const columns = ["type", "missing_side", "source", "target"];
    const rows = result.orphanEdges.map((r) => [r.type, r.missingSide, r.source, r.target]);
    lines.push(formatTable(columns, rows));
    lines.push("");
  }

  if (result.duplicateNodes.length > 0) {
    lines.push(`duplicate_nodes (${result.duplicateNodes.length}):`);
    const columns = ["type", "name", "file_path", "count", "ids"];
    const rows = result.duplicateNodes.map((r) => [
      r.type,
      r.name,
      r.file_path,
      String(r.count),
      r.ids.join(", "),
    ]);
    lines.push(formatTable(columns, rows));
    lines.push("");
  }

  return {
    output: lines.join("\n"),
    exitCode: ExitCode.NotFound,
  };
}
