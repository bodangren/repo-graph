import { Project, SyntaxKind, type SourceFile } from "ts-morph";
import type { GraphNode, GraphEdge, EdgeType } from "./contract";

export function scanProject(
  project: Project,
  packageMap?: Map<string, string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  function addNode(node: GraphNode): void {
    nodes.push(node);
  }

  function addEdge(source: string, target: string, type: EdgeType): void {
    edges.push({ source, target, type, direction: "forward", weight: 1.0 });
  }

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const fileNodeId = `file:${filePath}`;
    const packageId = packageMap?.get(filePath) ?? "root";

    addNode({
      id: fileNodeId,
      type: "file",
      name: filePath.split("/").pop()!,
      filePath,
      lineStart: 1,
      lineEnd: sourceFile.getEndLineNumber(),
      packageId,
    });

    // Functions
    let anonFuncIndex = 0;
    for (const func of sourceFile.getFunctions()) {
      const rawName = func.getName();
      const name = rawName || `anonymous${++anonFuncIndex}`;
      const id = `function:${filePath}:${name}`;
      const structure = func.getStructure();
      const summary = structure.docs && structure.docs.length > 0
        ? structure.docs[0].description
        : undefined;

      addNode({
        id,
        type: "function",
        name,
        filePath,
        lineStart: func.getStartLineNumber(),
        lineEnd: func.getEndLineNumber(),
        summary,
        tags: func.isExported() ? ["exported"] : undefined,
        packageId,
      });
      addEdge(fileNodeId, id, "contains");
    }

    // Arrow functions in variable declarations
    for (const stmt of sourceFile.getVariableStatements()) {
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (init?.getKind() === SyntaxKind.ArrowFunction) {
          const name = decl.getName();
          const id = `function:${filePath}:${name}`;
          addNode({
            id,
            type: "function",
            name,
            filePath,
            lineStart: decl.getStartLineNumber(),
            lineEnd: decl.getEndLineNumber(),
            tags: stmt.isExported() ? ["exported"] : undefined,
            packageId,
          });
          addEdge(fileNodeId, id, "contains");
        }
      }
    }

    // Classes
    for (const cls of sourceFile.getClasses()) {
      const name = cls.getName() || "anonymous";
      const id = `class:${filePath}:${name}`;

      addNode({
        id,
        type: "class",
        name,
        filePath,
        lineStart: cls.getStartLineNumber(),
        lineEnd: cls.getEndLineNumber(),
        tags: cls.isExported() ? ["exported"] : undefined,
        packageId,
      });
      addEdge(fileNodeId, id, "contains");

      // Class extends
      const ext = cls.getExtends();
      if (ext) {
        const baseName = ext.getExpression().getText();
        addEdge(id, `class:*:${baseName}`, "extends");
      }

      // Class implements
      for (const impl of cls.getImplements()) {
        const ifaceName = impl.getExpression().getText();
        addEdge(id, `interface:*:${ifaceName}`, "implements");
      }
    }

    // Interfaces
    for (const iface of sourceFile.getInterfaces()) {
      const name = iface.getName();
      const id = `interface:${filePath}:${name}`;

      addNode({
        id,
        type: "interface",
        name,
        filePath,
        lineStart: iface.getStartLineNumber(),
        lineEnd: iface.getEndLineNumber(),
        tags: iface.isExported() ? ["exported"] : undefined,
        packageId,
      });
      addEdge(fileNodeId, id, "contains");

      // Interface extends
      for (const ext of iface.getExtends()) {
        const baseName = ext.getExpression().getText();
        addEdge(id, `interface:*:${baseName}`, "extends");
      }
    }

    // Type aliases
    for (const alias of sourceFile.getTypeAliases()) {
      const name = alias.getName();
      const id = `type_alias:${filePath}:${name}`;

      addNode({
        id,
        type: "type_alias",
        name,
        filePath,
        lineStart: alias.getStartLineNumber(),
        lineEnd: alias.getEndLineNumber(),
        tags: alias.isExported() ? ["exported"] : undefined,
        packageId,
      });
      addEdge(fileNodeId, id, "contains");
    }

    // Imports
    for (const imp of sourceFile.getImportDeclarations()) {
      const resolved = imp.getModuleSpecifierSourceFile();
      if (resolved) {
        const targetPath = resolved.getFilePath();
        addEdge(fileNodeId, `file:${targetPath}`, "imports");
      } else {
        // Fallback: compute expected path from relative import specifier
        const specifier = imp.getModuleSpecifierValue();
        if (specifier && !specifier.startsWith(".") && !specifier.startsWith("/")) {
          // Skip non-relative imports (node_modules, aliases)
          continue;
        }
        if (specifier) {
          const { resolve } = require("path");
          const sourceDir = filePath.substring(0, filePath.lastIndexOf("/"));
          const computedPath = resolve(sourceDir, specifier);
          // Try common TS extensions
          const extensions = ["", ".ts", ".tsx", ".js", ".jsx"];
          const fs = require("fs");
          for (const ext of extensions) {
            try {
              if (fs.statSync(computedPath + ext).isFile()) {
                addEdge(fileNodeId, `file:${computedPath + ext}`, "imports");
                break;
              }
            } catch { /* not found */ }
          }
          // Also try index files in directories
          for (const index of ["/index.ts", "/index.tsx", "/index.js", "/index.jsx"]) {
            try {
              if (fs.statSync(computedPath + index).isFile()) {
                addEdge(fileNodeId, `file:${computedPath + index}`, "imports");
                break;
              }
            } catch { /* not found */ }
          }
        }
      }
    }
  }

  // Run additional scanner passes
  const schemaResult = scanSchemas(project, packageMap);
  nodes.push(...schemaResult.nodes);
  edges.push(...schemaResult.edges);

  const frameworkResult = scanFrameworkEdges(project, packageMap);
  nodes.push(...frameworkResult.nodes);
  edges.push(...frameworkResult.edges);

  // Create placeholder nodes for dangling wildcard edge targets
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.target) && edge.target.includes(":*:")) {
      const parts = edge.target.split(":");
      if (parts.length >= 3) {
        const type = parts[0] as GraphNode["type"];
        const name = parts.slice(2).join(":");
        nodes.push({
          id: edge.target,
          type,
          name,
          filePath: "",
          tags: ["unresolved"],
        });
        nodeIds.add(edge.target);
      }
    }
  }

  return { nodes, edges };
}

// ── Runtime Schema Extraction Pass (S1) ────────────────────────────────────

export function scanSchemas(
  project: Project,
  packageMap?: Map<string, string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  function addNode(node: GraphNode): void {
    nodes.push(node);
  }

  function addEdge(source: string, target: string, type: EdgeType): void {
    edges.push({ source, target, type, direction: "forward", weight: 1.0 });
  }

  function extractSchemaFromObjectLiteral(
    schemaName: string,
    objLiteral: import("ts-morph").ObjectLiteralExpression,
    filePath: string,
    lineStart: number,
    lineEnd: number,
    isExported: boolean,
    packageId?: string
  ): void {
    const schemaId = `schema:${filePath}:${schemaName}`;
    addNode({
      id: schemaId,
      type: "schema",
      name: schemaName,
      filePath,
      lineStart,
      lineEnd,
      tags: isExported ? ["exported"] : undefined,
      packageId,
    });
    addEdge(`file:${filePath}`, schemaId, "contains");

    for (const prop of objLiteral.getProperties()) {
      if (prop.getKind() === SyntaxKind.PropertyAssignment) {
        const pa = prop.asKind(SyntaxKind.PropertyAssignment)!;
        const fieldName = pa.getName();
        const fieldId = `field:${filePath}:${schemaName}.${fieldName}`;

        addNode({
          id: fieldId,
          type: "field",
          name: `${schemaName}.${fieldName}`,
          filePath,
          lineStart: pa.getStartLineNumber(),
          lineEnd: pa.getEndLineNumber(),
          packageId,
        });
        addEdge(schemaId, fieldId, "has_field");

        // Detect v.id("tableName") references
        const propInit = pa.getInitializer();
        if (propInit?.getKind() === SyntaxKind.CallExpression) {
          const propCall = propInit.asKind(SyntaxKind.CallExpression)!;
          const propExpr = propCall.getExpression();
          if (propExpr.getText() === "v.id") {
            const args = propCall.getArguments();
            if (args.length > 0 && args[0].getKind() === SyntaxKind.StringLiteral) {
              const refName = args[0].asKind(SyntaxKind.StringLiteral)!.getLiteralValue();
              addEdge(fieldId, `schema:*:${refName}`, "references");
            }
          }
        }
      }
    }
  }

  function tryExtractSchema(
    call: import("ts-morph").CallExpression,
    filePath: string,
    packageId?: string
  ): void {
    const expr = call.getExpression();
    const exprText = expr.getText();

    let schemaName: string | undefined;
    let objLiteral: import("ts-morph").ObjectLiteralExpression | undefined;

    if (exprText === "defineTable" || exprText === "z.object") {
      const args = call.getArguments();
      if (args.length > 0 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
        objLiteral = args[0].asKind(SyntaxKind.ObjectLiteralExpression)!;

        // Try to find a name from parent context
        const parent = call.getParent();
        if (parent) {
          if (parent.getKind() === SyntaxKind.PropertyAssignment) {
            schemaName = parent.asKind(SyntaxKind.PropertyAssignment)!.getName();
          } else if (parent.getKind() === SyntaxKind.VariableDeclaration) {
            schemaName = parent.asKind(SyntaxKind.VariableDeclaration)!.getName();
          }
        }

        if (schemaName && objLiteral) {
          // Determine if exported by walking up to variable statement
          let isExported = false;
          let stmt = call.getParent();
          while (stmt) {
            if (stmt.getKind() === SyntaxKind.VariableStatement) {
              isExported = stmt.asKind(SyntaxKind.VariableStatement)!.isExported();
              break;
            }
            if (stmt.getKind() === SyntaxKind.SourceFile) break;
            stmt = stmt.getParent();
          }

          extractSchemaFromObjectLiteral(
            schemaName,
            objLiteral,
            filePath,
            call.getStartLineNumber(),
            call.getEndLineNumber(),
            isExported,
            packageId
          );
        }
      }
    }
  }

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();
    const packageId = packageMap?.get(filePath);

    // Scan variable declarations for exported const object literals (config schemas)
    for (const stmt of sourceFile.getVariableStatements()) {
      const isExported = stmt.isExported();
      for (const decl of stmt.getDeclarations()) {
        const varName = decl.getName();
        const init = decl.getInitializer();
        if (isExported && init?.getKind() === SyntaxKind.ObjectLiteralExpression) {
          const objLiteral = init.asKind(SyntaxKind.ObjectLiteralExpression)!;
          extractSchemaFromObjectLiteral(
            varName,
            objLiteral,
            filePath,
            decl.getStartLineNumber(),
            decl.getEndLineNumber(),
            true,
            packageId
          );
        }
      }
    }

    // Recursively scan all call expressions for defineTable / z.object
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      tryExtractSchema(call, filePath, packageId);
    }
  }

  return { nodes, edges };
}

// ── Framework-Aware Edge Extraction Pass (S2) ──────────────────────────────

export function scanFrameworkEdges(
  project: Project,
  packageMap?: Map<string, string>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const edges: GraphEdge[] = [];

  function addEdge(source: string, target: string, type: EdgeType): void {
    edges.push({ source, target, type, direction: "forward", weight: 1.0 });
  }

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath();

    // Helper to scan a function body for framework patterns
    function scanFunctionBody(
      body: import("ts-morph").Node,
      sourceId: string
    ): void {
      // Call expressions
      for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        const exprText = expr.getText();

        // useQuery(api.x.y)
        if (exprText === "useQuery" || exprText === "useSuspenseQuery") {
          const target = extractApiFunctionTarget(call);
          if (target) addEdge(sourceId, target, "queries");
        }
        // useMutation(api.x.y)
        else if (exprText === "useMutation") {
          const target = extractApiFunctionTarget(call);
          if (target) addEdge(sourceId, target, "mutates");
        }
        // useHook()
        else if (exprText.startsWith("use") && !exprText.includes(".")) {
          addEdge(sourceId, `function:*:${exprText}`, "uses_hook");
        }
      }

      // JSX self-closing elements
      for (const jsx of body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)) {
        const tag = jsx.getTagNameNode().getText();
        if (isComponentName(tag)) {
          addEdge(sourceId, `function:*:${tag}`, "renders");
        }
      }

      // JSX opening elements (regular JSX elements)
      for (const jsx of body.getDescendantsOfKind(SyntaxKind.JsxElement)) {
        const open = jsx.getOpeningElement();
        const tag = open.getTagNameNode().getText();
        if (isComponentName(tag)) {
          addEdge(sourceId, `function:*:${tag}`, "renders");
        }
      }
    }

    // Named function declarations
    for (const func of sourceFile.getFunctions()) {
      const name = func.getName() || "anonymous";
      const id = `function:${filePath}:${name}`;
      const body = func.getBody();
      if (body) scanFunctionBody(body, id);
    }

    // Arrow functions in variable declarations
    for (const stmt of sourceFile.getVariableStatements()) {
      for (const decl of stmt.getDeclarations()) {
        const init = decl.getInitializer();
        if (init?.getKind() === SyntaxKind.ArrowFunction) {
          const arrow = init.asKind(SyntaxKind.ArrowFunction)!;
          const name = decl.getName();
          const id = `function:${filePath}:${name}`;
          const body = arrow.getBody();
          if (body) scanFunctionBody(body, id);
        }
      }
    }
  }

  return { nodes: [], edges };
}

function isComponentName(tag: string): boolean {
  // Component names start with uppercase; intrinsic elements (div, span) are lowercase
  if (tag.length === 0) return false;
  const first = tag[0];
  return first >= "A" && first <= "Z";
}

function extractApiFunctionTarget(call: import("ts-morph").CallExpression): string | undefined {
  const args = call.getArguments();
  if (args.length === 0) return undefined;
  const arg = args[0];

  // Expect api.module.function as chained property accesses
  if (arg.getKind() === SyntaxKind.PropertyAccessExpression) {
    const parts: string[] = [];
    let current: import("ts-morph").Node = arg;
    while (current.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = current.asKind(SyntaxKind.PropertyAccessExpression)!;
      parts.unshift(pa.getName());
      current = pa.getExpression();
    }
    if (current.getKind() === SyntaxKind.Identifier) {
      // Accept any root identifier name — the caller already verified it's
      // useQuery/useMutation, so the argument semantics are correct.
      return `function:*:${parts.join(".")}`;
    }
  }
  return undefined;
}
