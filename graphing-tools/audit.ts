import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { Project, SyntaxKind } from "ts-morph";
import { formatTable } from "./query";
import { ExitCode, type DocumentationIssue, type ExitCodeValue, type NodeDocumentation } from "./contract";

/** Complete structural and documentation audit result. */
export interface AuditResult {
  missingFiles: Array<{ id: string; type: string; name: string; file_path: string }>;
  staleSymbols: Array<{ id: string; type: string; name: string; file_path: string; line_start: number | null }>;
  orphanEdges: Array<{ source: string; target: string; type: string; missingSide: "source" | "target" | "both" }>;
  duplicateNodes: Array<{ name: string; type: string; file_path: string; ids: string[]; count: number }>;
  unauditedSymbols: Array<{ id: string; type: string; name: string; file_path: string; reason: string }>;
  documentationIssues?: DocumentationIssue[];
}

function findMissingFiles(db: Database): AuditResult["missingFiles"] {
  const rows = db.prepare("SELECT id, type, name, file_path FROM nodes WHERE type = 'file'").all() as
    Array<{ id: string; type: string; name: string; file_path: string }>;
  return rows.filter((r) => !existsSync(r.file_path));
}

function findOrphanEdges(db: Database): AuditResult["orphanEdges"] {
  const rows = db.prepare(`
    SELECT e.source, e.target, e.type, e.metadata,
           CASE WHEN ns.id IS NULL AND nt.id IS NULL THEN 'both'
                WHEN ns.id IS NULL THEN 'source'
                ELSE 'target' END AS missingSide
    FROM edges e
    LEFT JOIN nodes ns ON ns.id = e.source
    LEFT JOIN nodes nt ON nt.id = e.target
    WHERE ns.id IS NULL OR nt.id IS NULL
  `).all() as Array<{ source: string; target: string; type: string; metadata: string | null; missingSide: "source" | "target" | "both" }>;
  return rows.filter((row) => {
    if (row.missingSide !== "target") return true;
    if (row.target.includes(":*:")) return false;
    if (row.target.startsWith("unresolved-call:")) return false;
    if (row.target.startsWith("file:") && row.target.includes("/node_modules/")) return false;
    try {
      const metadata = row.metadata ? JSON.parse(row.metadata) as { resolution?: string } : undefined;
      return metadata?.resolution !== "external" && metadata?.resolution !== "unresolved";
    } catch {
      return true;
    }
  });
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
        if (name) {
          classNames.add(name);
          for (const method of cls.getMethods()) funcNames.add(`${name}.${method.getName()}`);
          for (const constructor of cls.getConstructors()) {
            if (constructor) funcNames.add(`${name}.constructor`);
          }
        }
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
  const rows = db.prepare("SELECT id, name, type, file_path FROM nodes WHERE file_path != '' ORDER BY id").all() as Array<{ id: string; name: string; type: string; file_path: string }>;
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const scope = row.type === "param" ? row.id.split(":").slice(0, -1).join(":") : row.file_path;
    const key = `${row.type}\u0000${scope}\u0000${row.name}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1).map((group) => ({
    name: group[0].name,
    type: group[0].type,
    file_path: group[0].file_path,
    ids: group.map((row) => row.id),
    count: group.length,
  }));
}

function parseNodeDocumentation(raw: string | null): NodeDocumentation | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as NodeDocumentation;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function documentationIssues(db: Database, includeInternal: boolean): DocumentationIssue[] {
  const rows = db.prepare("SELECT id, type, name, file_path, line_start, tags, documentation FROM nodes WHERE type IN ('function', 'class', 'interface', 'type_alias') AND file_path != '' ORDER BY id").all() as Array<{ id: string; type: string; name: string; file_path: string; line_start: number | null; tags: string | null; documentation: string | null }>;
  const issues: DocumentationIssue[] = [];
  const add = (row: typeof rows[number], category: DocumentationIssue["category"], message: string) => issues.push({ id: row.id, type: row.type as DocumentationIssue["type"], name: row.name, filePath: row.file_path, category, message });
  const project = new Project();
  const sourceFiles = new Map<string, import("ts-morph").SourceFile | undefined>();
  const sourceFileFor = (filePath: string): import("ts-morph").SourceFile | undefined => {
    if (sourceFiles.has(filePath)) return sourceFiles.get(filePath);
    try {
      const sourceFile = project.addSourceFileAtPath(filePath);
      sourceFiles.set(filePath, sourceFile);
      return sourceFile;
    } catch {
      sourceFiles.set(filePath, undefined);
      return undefined;
    }
  };

  for (const row of rows) {
    let tags: string[] = [];
    try { tags = row.tags ? JSON.parse(row.tags) as string[] : []; } catch { /* malformed tags are handled as undocumented */ }
    if (!includeInternal && !tags.includes("exported") && !tags.includes("public")) continue;
    const documentation = parseNodeDocumentation(row.documentation);
    if (!documentation || !documentation.hasJsDoc) {
      add(row, "missing_jsdoc", "No JSDoc block was persisted for this public API node.");
      continue;
    }
    if (!documentation.description) add(row, "missing_description", "The JSDoc block has no description.");

    const allowed = new Set(["param", "arg", "argument", "returns", "return", "deprecated", "throws", "example", "see", "remarks", "since", "template", "typeParam", "public", "private", "protected"]);
    const seenTags = new Set<string>();
    for (const tag of documentation.tags) {
      const identity = `${tag.name}:${tag.subject ?? tag.text}`;
      if (seenTags.has(identity)) add(row, "duplicate_tag", `Duplicate @${tag.name} tag.`);
      seenTags.add(identity);
      if (!allowed.has(tag.name)) add(row, "extra_tag", `Unsupported or extra @${tag.name} tag.`);
    }

    try {
      const sourceFile = sourceFileFor(row.file_path);
      if (!sourceFile) {
        add(row, "unsupported_form", "Declaration form could not be loaded for documentation validation.");
        continue;
      }
      const baseName = row.name.replace(/@\d+$/, "");
      let declaration: import("ts-morph").Node | undefined;
      if (row.type === "function") {
        const methodSplit = baseName.indexOf(".");
        if (methodSplit > 0) {
          const cls = sourceFile.getClass(baseName.slice(0, methodSplit));
          const methodName = baseName.slice(methodSplit + 1);
          const methods = cls?.getMethods().filter((method) => method.getName() === methodName) ?? [];
          declaration = methods.find((method) => method.getStartLineNumber() === row.line_start) ?? methods[0] ?? cls?.getConstructors()[0];
        } else {
          const functions = sourceFile.getFunctions().filter((fn) => (fn.getName() ?? (fn.isDefaultExport() ? "default" : "anonymous")) === baseName);
          declaration = functions.find((fn) => fn.getStartLineNumber() === row.line_start) ?? functions[0];
          if (!declaration) {
            for (const statement of sourceFile.getVariableStatements()) {
              const variable = statement.getDeclarations().find((decl) => decl.getName() === baseName);
              if (variable?.getInitializer()?.getKind() === SyntaxKind.ArrowFunction || variable?.getInitializer()?.getKind() === SyntaxKind.FunctionExpression) declaration = variable.getInitializer();
            }
          }
        }
      } else if (row.type === "class") declaration = sourceFile.getClass(baseName);
      else if (row.type === "interface") declaration = sourceFile.getInterface(baseName);
      else if (row.type === "type_alias") declaration = sourceFile.getTypeAlias(baseName);

      const callable = declaration as import("ts-morph").FunctionDeclaration | import("ts-morph").ArrowFunction | import("ts-morph").FunctionExpression | import("ts-morph").MethodDeclaration | undefined;
      if (callable?.getParameters) {
        const actualParams = callable.getParameters()
          .filter((param) => param.getNameNode().getKind() !== SyntaxKind.ObjectBindingPattern)
          .map((param) => param.getName().replace(/^\.\.\./, ""));
        const documentedParams = documentation.params.map((param) => param.name.replace(/^\.\.\./, ""));
        for (const param of actualParams) if (!documentedParams.includes(param) && param !== "__destructured") add(row, "missing_param", `Missing @param ${param}.`);
        for (const param of documentedParams) if (!actualParams.includes(param)) add(row, "extra_tag", `Extra @param ${param}.`);
        for (const param of documentation.params) if (!param.description) add(row, "mismatched_param", `@param ${param.name} has no description.`);
        const returnType = callable.getReturnType().getText().replace(/\s+/g, "");
        const returnsVoid = baseName.endsWith(".constructor") || returnType === "void" || returnType === "Promise<void>";
        if (!returnsVoid && !documentation.returns) add(row, "missing_returns", "Missing @returns for a value-returning function.");
      }
    } catch {
      add(row, "unsupported_form", "Declaration form could not be loaded for documentation validation.");
    }
  }
  return issues;
}

/**
 * Audit a persisted graph for structural, freshness, and optional JSDoc issues.
 *
 * @param db Open graph database to inspect.
 * @param opts Output and documentation-audit options.
 * @returns Serialized audit output and the corresponding process exit code.
 */
export function runAudit(
  db: Database,
  opts?: { json?: boolean; docs?: boolean; includeInternal?: boolean }
): { output: string; exitCode: ExitCodeValue } {
  const { staleSymbols, unauditedSymbols } = findStaleSymbols(db);
  const result: AuditResult = {
    missingFiles: findMissingFiles(db),
    staleSymbols,
    orphanEdges: findOrphanEdges(db),
    duplicateNodes: findDuplicateNodes(db),
    unauditedSymbols,
    ...(opts?.docs ? { documentationIssues: documentationIssues(db, opts.includeInternal ?? false) } : {}),
  };

  const hasIssues =
    result.missingFiles.length > 0 ||
    result.staleSymbols.length > 0 ||
    result.orphanEdges.length > 0 ||
    result.duplicateNodes.length > 0 ||
    result.unauditedSymbols.length > 0 || (result.documentationIssues?.length ?? 0) > 0;

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

  if ((result.documentationIssues?.length ?? 0) > 0) {
    lines.push(`documentation_issues (${result.documentationIssues!.length}):`);
    lines.push(formatTable(["category", "type", "name", "file_path", "message"], result.documentationIssues!.map((issue) => [issue.category, issue.type, issue.name, issue.filePath, issue.message])));
    lines.push("");
  }

  return {
    output: lines.join("\n"),
    exitCode: ExitCode.NotFound,
  };
}
