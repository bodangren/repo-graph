import { Project, SyntaxKind, type SourceFile, type FunctionDeclaration, type ArrowFunction } from "ts-morph";
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
      }
    }
  }

  // Run additional scanner passes
  const schemaResult = scanSchemas(project);
  nodes.push(...schemaResult.nodes);
  edges.push(...schemaResult.edges);

  const frameworkResult = scanFrameworkEdges(project);
  nodes.push(...frameworkResult.nodes);
  edges.push(...frameworkResult.edges);

  return { nodes, edges };
}

// ── Runtime Schema Extraction Pass (S1) ────────────────────────────────────

export function scanSchemas(project: Project): { nodes: GraphNode[]; edges: GraphEdge[] } {
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

    for (const stmt of sourceFile.getVariableStatements()) {
      const isExported = stmt.isExported();

      for (const decl of stmt.getDeclarations()) {
        const varName = decl.getName();
        const init = decl.getInitializer();
        if (!init) continue;

        let schemaName: string | undefined;
        let objLiteral: import("ts-morph").ObjectLiteralExpression | undefined;

        if (init.getKind() === SyntaxKind.CallExpression) {
          const call = init.asKind(SyntaxKind.CallExpression)!;
          const expr = call.getExpression();
          const exprText = expr.getText();

          // defineTable({ ... })
          if (exprText === "defineTable") {
            schemaName = varName;
            const args = call.getArguments();
            if (args.length > 0 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
              objLiteral = args[0].asKind(SyntaxKind.ObjectLiteralExpression)!;
            }
          }
          // z.object({ ... })
          else if (exprText === "z.object") {
            schemaName = varName;
            const args = call.getArguments();
            if (args.length > 0 && args[0].getKind() === SyntaxKind.ObjectLiteralExpression) {
              objLiteral = args[0].asKind(SyntaxKind.ObjectLiteralExpression)!;
            }
          }
        } else if (isExported && init.getKind() === SyntaxKind.ObjectLiteralExpression) {
          // exported const object literal
          schemaName = varName;
          objLiteral = init.asKind(SyntaxKind.ObjectLiteralExpression)!;
        }

        if (schemaName && objLiteral) {
          const schemaId = `schema:${filePath}:${schemaName}`;
          addNode({
            id: schemaId,
            type: "schema",
            name: schemaName,
            filePath,
            lineStart: decl.getStartLineNumber(),
            lineEnd: decl.getEndLineNumber(),
            tags: isExported ? ["exported"] : undefined,
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
      }
    }
  }

  return { nodes, edges };
}

// ── Framework-Aware Edge Extraction Pass (S2) ──────────────────────────────

export function scanFrameworkEdges(project: Project): { nodes: GraphNode[]; edges: GraphEdge[] } {
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
        if (exprText === "useQuery") {
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
      const id = current.asKind(SyntaxKind.Identifier)!;
      if (id.getText() === "api") {
        return `function:*:${parts.join(".")}`;
      }
    }
  }
  return undefined;
}
