import { Project, SyntaxKind } from "ts-morph";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "./contract";

export function scanProject(project: Project): { nodes: GraphNode[]; edges: GraphEdge[] } {
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

    addNode({
      id: fileNodeId,
      type: "file",
      name: filePath.split("/").pop()!,
      filePath,
      lineStart: 1,
      lineEnd: sourceFile.getEndLineNumber(),
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

  return { nodes, edges };
}
