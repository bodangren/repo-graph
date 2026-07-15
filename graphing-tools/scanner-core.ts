import {
  Node,
  Project,
  SyntaxKind,
  type CallExpression,
  type ClassDeclaration,
  type FunctionDeclaration,
  type MethodDeclaration,
  type Node as TsMorphNode,
  type SourceFile,
} from "ts-morph";
import { existsSync, statSync } from "fs";
import { dirname, resolve } from "path";
import type {
  DocumentationParam,
  DocumentationTag,
  EdgeType,
  GraphEdge,
  GraphNode,
  NodeDocumentation,
} from "./contract";
import {
  scanFrameworkEdges,
  scanParamFlow,
  scanRoutes,
  scanSchemas,
  scanStringLiterals,
} from "./scanner";

interface SymbolRecord {
  declaration: TsMorphNode;
  node: GraphNode;
  sourceFile: SourceFile;
  baseName: string;
}

interface ScanResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const BRANCH_KINDS = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.BinaryExpression,
]);

function computeComplexity(body: TsMorphNode | undefined): "simple" | "moderate" | "complex" {
  if (!body) return "simple";
  let count = 0;
  for (const descendant of body.getDescendants()) {
    if (!BRANCH_KINDS.has(descendant.getKind())) continue;
    if (descendant.getKind() === SyntaxKind.BinaryExpression) {
      const op = descendant.asKind(SyntaxKind.BinaryExpression)?.getOperatorToken().getKind();
      if (op !== SyntaxKind.AmpersandAmpersandToken && op !== SyntaxKind.BarBarToken) continue;
    }
    count++;
  }
  if (count >= 16) return "complex";
  if (count >= 6) return "moderate";
  return "simple";
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();
}

function getJsDocs(node: TsMorphNode): import("ts-morph").JSDoc[] {
  const candidate = node as TsMorphNode & { getJsDocs?: () => import("ts-morph").JSDoc[] };
  return candidate.getJsDocs?.() ?? [];
}

function extractDocumentation(node: TsMorphNode, declarationForm: string): NodeDocumentation {
  const docs = getJsDocs(node);
  const description = normalizeText(docs.map((doc) => doc.getDescription()).filter(Boolean).join("\n"));
  const params: DocumentationParam[] = [];
  const tags: DocumentationTag[] = [];
  let returns: string | undefined;

  for (const doc of docs) {
    for (const tag of doc.getTags()) {
      const name = tag.getTagName();
      const text = normalizeText(tag.getCommentText());
      const propertyTag = tag as unknown as import("ts-morph").JSDocPropertyLikeTag;
      const subject = (name === "param" || name === "arg" || name === "argument")
        ? normalizeText(propertyTag.getName())
        : undefined;
      tags.push({ name, text, ...(subject ? { subject } : {}) });
      if (name === "param" || name === "arg" || name === "argument") {
        params.push({ name: subject ?? "", description: text });
      } else if (name === "returns" || name === "return") {
        returns = text;
      }
    }
  }

  return {
    version: 1,
    hasJsDoc: docs.length > 0,
    description,
    params,
    ...(returns ? { returns } : {}),
    tags,
    declarationForm,
  };
}

function declarationKey(declaration: TsMorphNode): string {
  return `${declaration.getSourceFile().getFilePath()}:${declaration.getStart()}`;
}

function isExportedDeclaration(declaration: TsMorphNode): boolean {
  const candidate = declaration as TsMorphNode & { isExported?: () => boolean };
  return candidate.isExported?.() ?? false;
}

function isPublicMethod(method: MethodDeclaration): boolean {
  return !method.hasModifier(SyntaxKind.PrivateKeyword) && !method.hasModifier(SyntaxKind.ProtectedKeyword);
}

function resolveImportPath(sourceFile: SourceFile, specifier: string): string | undefined {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return undefined;
  const base = resolve(dirname(sourceFile.getFilePath()), specifier);
  for (const suffix of ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]) {
    const candidate = base + suffix;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep trying the TypeScript resolution variants.
    }
  }
  return undefined;
}

function addEdge(edges: GraphEdge[], source: string, target: string, type: EdgeType | string, metadata?: unknown): void {
  edges.push({
    source,
    target,
    type,
    direction: "forward",
    weight: 1,
    ...(metadata === undefined ? {} : { metadata: JSON.stringify(metadata) }),
  });
}

function addDocumentationNodeFields(node: GraphNode, declaration: TsMorphNode, form: string): void {
  const documentation = extractDocumentation(declaration, form);
  node.documentation = documentation;
  if (documentation.description) node.summary = documentation.description;
}

function methodNodeName(cls: ClassDeclaration, method: MethodDeclaration): string {
  return `${cls.getName() ?? "anonymous"}.${method.getName()}`;
}

function addSymbol(
  symbols: Map<string, SymbolRecord>,
  nodes: GraphNode[],
  edges: GraphEdge[],
  declaration: TsMorphNode,
  sourceFile: SourceFile,
  type: GraphNode["type"],
  baseName: string,
  packageId: string,
  exported: boolean,
  parentId: string,
  form: string,
  complexityBody?: TsMorphNode,
  extraTags: string[] = []
): GraphNode {
  const filePath = sourceFile.getFilePath();
  const duplicateCount = nodes.filter((node) =>
    node.type === type &&
    node.filePath === filePath &&
    (node.name === baseName || node.name.startsWith(`${baseName}@`))
  ).length;
  const name = duplicateCount === 0 ? baseName : `${baseName}@${declaration.getStartLineNumber()}`;
  const id = `${type}:${filePath}:${name}`;
  const node: GraphNode = {
    id,
    type,
    name,
    filePath,
    lineStart: declaration.getStartLineNumber(),
    lineEnd: declaration.getEndLineNumber(),
    tags: exported || extraTags.length > 0 ? Array.from(new Set([...(exported ? ["exported"] : []), ...extraTags])) : undefined,
    complexity: complexityBody ? computeComplexity(complexityBody) : undefined,
    packageId,
  };
  addDocumentationNodeFields(node, declaration, form);
  nodes.push(node);
  symbols.set(declarationKey(declaration), { declaration, node, sourceFile, baseName });
  addEdge(edges, parentId, id, "contains");
  return node;
}

function findOwner(call: CallExpression, symbols: Map<string, SymbolRecord>): SymbolRecord | undefined {
  let current: TsMorphNode | undefined = call.getParent();
  while (current) {
    const record = symbols.get(declarationKey(current));
    if (record) return record;
    current = current.getParent();
  }
  return undefined;
}

function recordsForFileAndName(symbols: Map<string, SymbolRecord>, filePath: string, name: string): SymbolRecord[] {
  return Array.from(symbols.values())
    .filter((record) => record.sourceFile.getFilePath() === filePath && (record.baseName === name || record.node.name === name))
    .sort((a, b) => a.node.id.localeCompare(b.node.id));
}

function resolveCallTarget(call: CallExpression, owner: SymbolRecord, symbols: Map<string, SymbolRecord>): SymbolRecord | undefined {
  const expression = call.getExpression().getText();
  const parts = expression.split(".");
  const calledName = parts.at(-1) ?? expression;
  const qualifier = parts.length > 1 ? parts.at(-2) : undefined;
  const sourceFile = owner.sourceFile;

  if (!qualifier || qualifier === "this") {
    const local = recordsForFileAndName(symbols, sourceFile.getFilePath(), calledName);
    if (local.length > 0) return local[0];
  }

  if (qualifier) {
    const localMethod = recordsForFileAndName(symbols, sourceFile.getFilePath(), `${qualifier}.${calledName}`);
    if (localMethod.length > 0) return localMethod[0];
    if (qualifier === "this" && owner.node.name.includes(".")) {
      const className = owner.node.name.split(".")[0];
      const ownerMethod = recordsForFileAndName(symbols, sourceFile.getFilePath(), `${className}.${calledName}`);
      if (ownerMethod.length > 0) return ownerMethod[0];
    }
  }

  for (const declaration of sourceFile.getImportDeclarations()) {
    const importedPath = declaration.getModuleSpecifierSourceFile()?.getFilePath() ?? resolveImportPath(sourceFile, declaration.getModuleSpecifierValue());
    if (!importedPath) continue;
    const named = declaration.getNamedImports().find((item) => item.getAliasNode()?.getText() === (qualifier ?? calledName) || item.getName() === (qualifier ?? calledName));
    if (named) {
      return recordsForFileAndName(symbols, importedPath, named.getName())[0];
    }
    const defaultImport = declaration.getDefaultImport()?.getText();
    if (defaultImport === (qualifier ?? calledName)) {
      return recordsForFileAndName(symbols, importedPath, "default")[0] ?? recordsForFileAndName(symbols, importedPath, defaultImport)[0];
    }
  }
  return undefined;
}

function addCallEdges(sourceFiles: SourceFile[], symbols: Map<string, SymbolRecord>, nodes: GraphNode[], edges: GraphEdge[]): void {
  const unresolvedById = new Map<string, GraphNode>();
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const owner = findOwner(call, symbols);
      if (!owner) continue;
      const target = resolveCallTarget(call, owner, symbols);
      if (target) {
        addEdge(edges, owner.node.id, target.node.id, "calls", {
          resolution: "resolved",
          expression: call.getExpression().getText(),
        });
        continue;
      }

      const unresolvedId = `unresolved-call:${sourceFile.getFilePath()}:${call.getStart()}`;
      if (!unresolvedById.has(unresolvedId)) {
        const unresolved: GraphNode = {
          id: unresolvedId,
          type: "function",
          name: call.getExpression().getText(),
          filePath: "",
          lineStart: call.getStartLineNumber(),
          lineEnd: call.getEndLineNumber(),
          tags: ["unresolved", "dynamic"],
        };
        unresolvedById.set(unresolvedId, unresolved);
        nodes.push(unresolved);
      }
      addEdge(edges, owner.node.id, unresolvedId, "calls", {
        resolution: "unresolved",
        expression: call.getExpression().getText(),
      });
    }
  }
}

function deduplicateAndSort(result: ScanResult): ScanResult {
  const nodeMap = new Map<string, GraphNode>();
  for (const node of result.nodes) nodeMap.set(node.id, node);
  const edgeMap = new Map<string, GraphEdge>();
  for (const edge of result.edges) {
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.type}\u0000${edge.metadata ?? ""}`;
    edgeMap.set(key, edge);
  }
  const nodes = Array.from(nodeMap.values()).sort((a, b) =>
    (a.filePath === "" ? 1 : 0) - (b.filePath === "" ? 1 : 0) || a.id.localeCompare(b.id)
  );
  const edges = Array.from(edgeMap.values()).sort((a, b) => {
    const left = `${a.source}\u0000${a.target}\u0000${a.type}\u0000${a.metadata ?? ""}`;
    const right = `${b.source}\u0000${b.target}\u0000${b.type}\u0000${b.metadata ?? ""}`;
    return left.localeCompare(right);
  });
  return { nodes, edges };
}

/** Scan a TypeScript project into deterministic nodes and persisted relationships. */
/**
 * Scan a TypeScript project into a deterministic graph snapshot.
 *
 * @param project Project whose source files are scanned.
 * @param packageMap Optional file-to-package ownership map.
 * @returns Nodes and edges sorted and deduplicated for persistence.
 */
export function scanProject(project: Project, packageMap?: Map<string, string>): ScanResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const symbols = new Map<string, SymbolRecord>();
  const sourceFiles = [...project.getSourceFiles()].sort((a, b) => a.getFilePath().localeCompare(b.getFilePath()));

  for (const sourceFile of sourceFiles) {
    const filePath = sourceFile.getFilePath();
    const packageId = packageMap?.get(filePath) ?? "root";
    const fileId = `file:${filePath}`;
    nodes.push({
      id: fileId,
      type: "file",
      name: filePath.split("/").pop() ?? filePath,
      filePath,
      lineStart: 1,
      lineEnd: sourceFile.getEndLineNumber(),
      packageId,
    });

    for (const declaration of sourceFile.getFunctions()) {
      const functionName = declaration.getName() ?? (declaration.isDefaultExport() ? "default" : "anonymous");
      addSymbol(symbols, nodes, edges, declaration, sourceFile, "function", functionName, packageId, declaration.isExported(), fileId, "function", declaration.getBody());
    }

    for (const statement of sourceFile.getVariableStatements()) {
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (!initializer || (initializer.getKind() !== SyntaxKind.ArrowFunction && initializer.getKind() !== SyntaxKind.FunctionExpression)) continue;
        const functionNode = addSymbol(
          symbols,
          nodes,
          edges,
          initializer,
          sourceFile,
          "function",
          declaration.getName(),
          packageId,
          statement.isExported(),
          fileId,
          initializer.getKind() === SyntaxKind.ArrowFunction ? "arrow_function" : "function_expression",
          initializer,
        );
        if (!getJsDocs(initializer).length && getJsDocs(statement).length) {
          addDocumentationNodeFields(functionNode, statement, "variable_function");
        }
      }
    }

    for (const cls of sourceFile.getClasses()) {
      const classNode = addSymbol(symbols, nodes, edges, cls, sourceFile, "class", cls.getName() ?? "anonymous", packageId, cls.isExported(), fileId, "class");
      const classExported = cls.isExported();
      for (const method of cls.getMethods()) {
        const methodNode = addSymbol(symbols, nodes, edges, method, sourceFile, "function", methodNodeName(cls, method), packageId, classExported && isPublicMethod(method), classNode.id, "public_method", method.getBody(), isPublicMethod(method) ? ["public"] : ["internal"]);
        if (!getJsDocs(method).length && classExported && isPublicMethod(method)) methodNode.tags = Array.from(new Set([...(methodNode.tags ?? []), "public"]));
      }
      for (const ctor of cls.getConstructors()) {
        addSymbol(symbols, nodes, edges, ctor, sourceFile, "function", `${cls.getName() ?? "anonymous"}.constructor`, packageId, classExported, classNode.id, "constructor", ctor.getBody(), ["constructor"]);
      }
    }

    for (const iface of sourceFile.getInterfaces()) {
      addSymbol(symbols, nodes, edges, iface, sourceFile, "interface", iface.getName(), packageId, iface.isExported(), fileId, "interface");
      for (const ext of iface.getExtends()) addEdge(edges, `interface:${filePath}:${iface.getName()}`, `interface:*:${ext.getExpression().getText()}`, "extends");
    }

    for (const alias of sourceFile.getTypeAliases()) {
      addSymbol(symbols, nodes, edges, alias, sourceFile, "type_alias", alias.getName(), packageId, alias.isExported(), fileId, "type_alias");
    }

    for (const cls of sourceFile.getClasses()) {
      const classId = `class:${filePath}:${cls.getName() ?? "anonymous"}`;
      const ext = cls.getExtends();
      if (ext) addEdge(edges, classId, `class:*:${ext.getExpression().getText()}`, "extends");
      for (const impl of cls.getImplements()) addEdge(edges, classId, `interface:*:${impl.getExpression().getText()}`, "implements");
    }

    for (const declaration of sourceFile.getImportDeclarations()) {
      const resolved = declaration.getModuleSpecifierSourceFile()?.getFilePath() ?? resolveImportPath(sourceFile, declaration.getModuleSpecifierValue());
      if (resolved) addEdge(edges, fileId, `file:${resolved}`, "imports");
    }
  }

  addCallEdges(sourceFiles, symbols, nodes, edges);
  const packageIdFor = (filePath: string) => packageMap?.get(filePath) ?? "root";
  for (const pass of [
    scanSchemas(project, packageMap),
    scanFrameworkEdges(project, packageMap),
    scanStringLiterals(project, packageMap),
    scanParamFlow(project, packageMap),
    scanRoutes(project, packageMap),
  ]) {
    nodes.push(...pass.nodes.map((node) => ({ ...node, packageId: node.packageId ?? (node.filePath ? packageIdFor(node.filePath) : undefined) })));
    edges.push(...pass.edges);
  }

  const knownIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (knownIds.has(edge.target) || !edge.target.includes(":*:")) continue;
    const [type, , ...nameParts] = edge.target.split(":");
    const placeholder: GraphNode = { id: edge.target, type: type as GraphNode["type"], name: nameParts.join(":"), filePath: "", tags: ["unresolved"] };
    nodes.push(placeholder);
    knownIds.add(placeholder.id);
  }
  return deduplicateAndSort({ nodes, edges });
}
