import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { Project, SyntaxKind } from "ts-morph";
import { formatTable } from "./query";
import { ExitCode } from "./contract";

export interface AuditResult {
  missingFiles: Array<{ id: string; type: string; name: string; file_path: string }>;
  staleSymbols: Array<{ id: string; type: string; name: string; file_path: string; line_start: number | null }>;
  orphanEdges: Array<{ source: string; target: string; type: string; missingSide: "source" | "target" | "both" }>;
  duplicateNodes: Array<{ name: string; type: string; file_path: string; ids: string[]; count: number }>;
  unauditedSymbols: Array<{ id: string; type: string; name: string; file_path: string; reason: string }>;
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

function findStaleSymbols(db: Database): Pick<AuditResult, "staleSymbols" | "unauditedSymbols"> {
  const symbolNodes = db.prepare("SELECT id, type, name, file_path, line_start FROM nodes WHERE type != 'file' AND file_path != ''").all() as
    Array<{ id: string; type: string; name: string; file_path: string; line_start: number | null }>;

  if (symbolNodes.length === 0) return { staleSymbols: [], unauditedSymbols: [] };

  // Group nodes by file_path
  const byFile = new Map<string, typeof symbolNodes>();
  for (const node of symbolNodes) {
    if (!byFile.has(node.file_path)) byFile.set(node.file_path, []);
    byFile.get(node.file_path)!.push(node);
  }

  const stale: AuditResult["staleSymbols"] = [];
  const unaudited: AuditResult["unauditedSymbols"] = [];

  for (const [filePath, nodes] of byFile) {
    if (!existsSync(filePath)) {
      // File is missing; all its symbols are stale
      for (const node of nodes) {
        stale.push(node);
      }
      continue;
    }

    try {
      const project = new Project();
      const sourceFile = project.addSourceFileAtPath(filePath);

      // Build sets of existing symbol names by type
      const existing = new Map<string, Set<string>>();

      // Functions: declarations + arrow functions in variables
      const funcNames = new Set<string>();
      for (const func of sourceFile.getFunctions()) {
        const name = func.getName();
        if (name) funcNames.add(name);
      }
      for (const stmt of sourceFile.getVariableStatements()) {
        for (const decl of stmt.getDeclarations()) {
          const init = decl.getInitializer();
          if (init?.getKind() === SyntaxKind.ArrowFunction) {
            funcNames.add(decl.getName());
          }
        }
      }
      existing.set("function", funcNames);

      // Classes
      const classNames = new Set<string>();
      for (const cls of sourceFile.getClasses()) {
        const name = cls.getName();
        if (name) classNames.add(name);
      }
      existing.set("class", classNames);

      // Interfaces
      const interfaceNames = new Set<string>();
      for (const iface of sourceFile.getInterfaces()) {
        interfaceNames.add(iface.getName());
      }
      existing.set("interface", interfaceNames);

      // Type aliases
      const typeAliasNames = new Set<string>();
      for (const alias of sourceFile.getTypeAliases()) {
        typeAliasNames.add(alias.getName());
      }
      existing.set("type_alias", typeAliasNames);

      // Schemas: defineTable(schemaName), z.object(...), or exported const object literals
      const schemaNames = new Set<string>();
      for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const exprText = call.getExpression().getText();
        if (exprText === "defineTable" || exprText === "z.object") {
          const parent = call.getParent();
          if (parent) {
            if (parent.getKind() === SyntaxKind.PropertyAssignment) {
              schemaNames.add(parent.asKind(SyntaxKind.PropertyAssignment)!.getName());
            } else if (parent.getKind() === SyntaxKind.VariableDeclaration) {
              schemaNames.add(parent.asKind(SyntaxKind.VariableDeclaration)!.getName());
            }
          }
        }
      }
      for (const stmt of sourceFile.getVariableStatements()) {
        if (stmt.isExported()) {
          for (const decl of stmt.getDeclarations()) {
            const init = decl.getInitializer();
            if (init?.getKind() === SyntaxKind.ObjectLiteralExpression) {
              schemaNames.add(decl.getName());
            }
          }
        }
      }
      existing.set("schema", schemaNames);

      // Params: collect param names per function
      const paramsByFunction = new Map<string, Set<string>>();
      function collectParams(func: import("ts-morph").FunctionDeclaration | import("ts-morph").ArrowFunction, funcName: string): void {
        const paramSet = new Set<string>();
        for (const param of func.getParameters()) {
          const nameNode = param.getNameNode();
          if (nameNode.getKind() === SyntaxKind.ObjectBindingPattern) {
            for (const element of nameNode.asKind(SyntaxKind.ObjectBindingPattern)!.getElements()) {
              paramSet.add(element.getName());
            }
          } else if (nameNode.getKind() === SyntaxKind.Identifier) {
            paramSet.add(nameNode.asKind(SyntaxKind.Identifier)!.getText());
          }
        }
        paramsByFunction.set(funcName, paramSet);
      }
      for (const func of sourceFile.getFunctions()) {
        const name = func.getName();
        if (name) collectParams(func, name);
      }
      for (const stmt of sourceFile.getVariableStatements()) {
        for (const decl of stmt.getDeclarations()) {
          const init = decl.getInitializer();
          if (init?.getKind() === SyntaxKind.ArrowFunction) {
            collectParams(init.asKind(SyntaxKind.ArrowFunction)!, decl.getName());
          }
        }
      }

      // Check each stored node
      for (const node of nodes) {
        if (node.type === "field" || node.type === "route") {
          unaudited.push({
            id: node.id,
            type: node.type,
            name: node.name,
            file_path: node.file_path,
            reason: `Stale-symbol detection for ${node.type} nodes requires full scanner re-run`,
          });
          continue;
        }

        if (node.type === "param") {
          // id format: param:filePath:funcName:paramName
          const parts = node.id.split(":");
          const funcName = parts.length >= 3 ? parts[parts.length - 2] : undefined;
          const paramName = parts.length >= 3 ? parts[parts.length - 1] : node.name;
          if (!funcName || !paramsByFunction.has(funcName) || !paramsByFunction.get(funcName)!.has(paramName)) {
            stale.push(node);
          }
          continue;
        }

        const names = existing.get(node.type);
        if (names && !names.has(node.name)) {
          stale.push(node);
        }
      }
    } catch {
      // If we can't parse the file, skip its symbols
    }
  }

  return { staleSymbols: stale, unauditedSymbols: unaudited };
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
  const { staleSymbols, unauditedSymbols } = findStaleSymbols(db);
  const result: AuditResult = {
    missingFiles: findMissingFiles(db),
    staleSymbols,
    orphanEdges: findOrphanEdges(db),
    duplicateNodes: findDuplicateNodes(db),
    unauditedSymbols,
  };

  const hasIssues =
    result.missingFiles.length > 0 ||
    result.staleSymbols.length > 0 ||
    result.orphanEdges.length > 0 ||
    result.duplicateNodes.length > 0 ||
    result.unauditedSymbols.length > 0;

  if (opts?.json) {
    return {
      output: JSON.stringify(result),
      exitCode: hasIssues ? ExitCode.NotFound : ExitCode.Success,
    };
  }

  if (!hasIssues && result.unauditedSymbols.length === 0) {
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

  if (result.staleSymbols.length > 0) {
    lines.push(`stale_symbols (${result.staleSymbols.length}):`);
    const columns = ["type", "name", "file_path", "line_start"];
    const rows = result.staleSymbols.map((r) => [
      r.type,
      r.name,
      r.file_path,
      r.line_start != null ? String(r.line_start) : "",
    ]);
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

  if (result.unauditedSymbols.length > 0) {
    lines.push(`unaudited_symbols (${result.unauditedSymbols.length}):`);
    const columns = ["type", "name", "file_path", "reason"];
    const rows = result.unauditedSymbols.map((r) => [r.type, r.name, r.file_path, r.reason]);
    lines.push(formatTable(columns, rows));
    lines.push("");
  }

  return {
    output: lines.join("\n"),
    exitCode: ExitCode.NotFound,
  };
}
