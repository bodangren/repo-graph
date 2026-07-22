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
import { statSync } from "fs";
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

interface SymbolIndexes {
  byDeclaration: Map<string, SymbolRecord>;
  byFileAndName: Map<string, SymbolRecord[]>;
  nameFamilyCounts: Map<string, number>;
}

interface ScanResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Named scanner lifecycle boundary emitted for performance diagnostics. */
export type ScanStageName =
  | "project_discovery"
  | "primary_extraction"
  | "schema_pass"
  | "framework_pass"
  | "string_literal_pass"
  | "param_flow_pass"
  | "route_pass"
  | "call_resolution"
  | "deduplication"
  | "persistence";

/** Timing and resident-memory sample for one scanner lifecycle boundary. */
export interface ScanStageDiagnostic {
  stage: ScanStageName;
  elapsedMs: number;
  rssBytes: number;
}

/** Observer receiving scanner diagnostics without changing graph output. */
export type ScanStageObserver = (diagnostic: ScanStageDiagnostic) => void;

function emitStage(
  stage: ScanStageName,
  startedAt: number,
  observer?: ScanStageObserver,
): void {
  observer?.({
    stage,
    elapsedMs: Math.round(performance.now() - startedAt),
    rssBytes: process.memoryUsage().rss,
  });
}

/** Lightweight symbol lookup retained after a ts-morph Project is released. */
export interface SymbolLookupEntry {
  filePath: string;
  lookupName: string;
  targetId: string;
}

/** Import binding used by the AST-free global call resolver. */
export interface ImportBinding {
  sourceFilePath: string;
  declarationOrder: number;
  bindingOrder: number;
  targetFilePath: string;
  kind: "named" | "default";
  localName: string;
  importedName: string;
}

/** Call site whose target is resolved after all project batches are scanned. */
export interface DeferredCallSite {
  ownerId: string;
  ownerName: string;
  sourceFilePath: string;
  callStart: number;
  lineStart: number;
  lineEnd: number;
  expression: string;
}

/** AST-free graph fragment emitted by one project batch. */
export interface ProjectGraphFragment {
  nodes: GraphNode[];
  edges: GraphEdge[];
  symbolLookups: SymbolLookupEntry[];
  importBindings: ImportBinding[];
  deferredCalls: DeferredCallSite[];
}

/** Resolve one module specifier to a source file path. */
export type ModuleResolver = (sourceFilePath: string, specifier: string) => string | undefined;

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

function fileAndNameKey(filePath: string, name: string): string {
  return `${filePath}\u0000${name}`;
}

function nameFamilyKey(type: GraphNode["type"], filePath: string, name: string): string {
  return `${type}\u0000${filePath}\u0000${name}`;
}

function nameFamilies(name: string): string[] {
  const families = [name];
  for (let index = name.indexOf("@"); index >= 0; index = name.indexOf("@", index + 1)) {
    families.push(name.slice(0, index));
  }
  return Array.from(new Set(families));
}

function registerNameFamily(indexes: SymbolIndexes, type: GraphNode["type"], filePath: string, name: string): void {
  for (const family of nameFamilies(name)) {
    const key = nameFamilyKey(type, filePath, family);
    indexes.nameFamilyCounts.set(key, (indexes.nameFamilyCounts.get(key) ?? 0) + 1);
  }
}

function registerSymbolLookup(indexes: SymbolIndexes, record: SymbolRecord): void {
  for (const name of new Set([record.baseName, record.node.name])) {
    const key = fileAndNameKey(record.sourceFile.getFilePath(), name);
    const records = indexes.byFileAndName.get(key);
    if (records) records.push(record);
    else indexes.byFileAndName.set(key, [record]);
  }
}

function sortSymbolLookups(indexes: SymbolIndexes): void {
  for (const records of indexes.byFileAndName.values()) {
    records.sort((left, right) => left.node.id.localeCompare(right.node.id));
  }
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
  indexes: SymbolIndexes,
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
  const duplicateCount = indexes.nameFamilyCounts.get(nameFamilyKey(type, filePath, baseName)) ?? 0;
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
  const record = { declaration, node, sourceFile, baseName };
  indexes.byDeclaration.set(declarationKey(declaration), record);
  registerNameFamily(indexes, type, filePath, name);
  registerSymbolLookup(indexes, record);
  addEdge(edges, parentId, id, "contains");
  return node;
}

function findOwner(call: CallExpression, indexes: SymbolIndexes): SymbolRecord | undefined {
  let current: TsMorphNode | undefined = call.getParent();
  while (current) {
    const record = indexes.byDeclaration.get(declarationKey(current));
    if (record) return record;
    current = current.getParent();
  }
  return undefined;
}

function resolveImportedPath(
  sourceFile: SourceFile,
  specifier: string,
  resolveModule?: ModuleResolver,
): string | undefined {
  if (resolveModule) {
    return resolveModule(sourceFile.getFilePath(), specifier);
  }
  const declaration = sourceFile.getImportDeclarations().find(
    (candidate) => candidate.getModuleSpecifierValue() === specifier,
  );
  return declaration?.getModuleSpecifierSourceFile()?.getFilePath()
    ?? resolveImportPath(sourceFile, specifier);
}

function extractSymbolLookups(indexes: SymbolIndexes): SymbolLookupEntry[] {
  const lookups: SymbolLookupEntry[] = [];
  for (const [key, records] of indexes.byFileAndName) {
    const separator = key.indexOf("\u0000");
    const filePath = key.slice(0, separator);
    const lookupName = key.slice(separator + 1);
    for (const record of records) {
      lookups.push({ filePath, lookupName, targetId: record.node.id });
    }
  }
  return lookups.sort((left, right) =>
    left.filePath.localeCompare(right.filePath)
    || left.lookupName.localeCompare(right.lookupName)
    || left.targetId.localeCompare(right.targetId)
  );
}

function extractImportBindings(
  sourceFiles: readonly SourceFile[],
  resolveModule?: ModuleResolver,
): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const sourceFile of sourceFiles) {
    sourceFile.getImportDeclarations().forEach((declaration, declarationOrder) => {
      const targetFilePath = resolveImportedPath(
        sourceFile,
        declaration.getModuleSpecifierValue(),
        resolveModule,
      );
      if (!targetFilePath) return;
      const namedImports = declaration.getNamedImports();
      namedImports.forEach((item, bindingOrder) => {
        bindings.push({
          sourceFilePath: sourceFile.getFilePath(),
          declarationOrder,
          bindingOrder,
          targetFilePath,
          kind: "named",
          localName: item.getAliasNode()?.getText() ?? item.getName(),
          importedName: item.getName(),
        });
      });
      const defaultImport = declaration.getDefaultImport()?.getText();
      if (defaultImport) {
        bindings.push({
          sourceFilePath: sourceFile.getFilePath(),
          declarationOrder,
          bindingOrder: namedImports.length,
          targetFilePath,
          kind: "default",
          localName: defaultImport,
          importedName: "default",
        });
      }
    });
  }
  return bindings;
}

function extractDeferredCalls(
  sourceFiles: readonly SourceFile[],
  indexes: SymbolIndexes,
): DeferredCallSite[] {
  const calls: DeferredCallSite[] = [];
  for (const sourceFile of sourceFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const owner = findOwner(call, indexes);
      if (!owner) continue;
      calls.push({
        ownerId: owner.node.id,
        ownerName: owner.node.name,
        sourceFilePath: sourceFile.getFilePath(),
        callStart: call.getStart(),
        lineStart: call.getStartLineNumber(),
        lineEnd: call.getEndLineNumber(),
        expression: call.getExpression().getText(),
      });
    }
  }
  return calls;
}

function lookupTarget(
  lookups: ReadonlyMap<string, readonly string[]>,
  filePath: string,
  name: string,
): string | undefined {
  return lookups.get(fileAndNameKey(filePath, name))?.[0];
}

function resolveDeferredCallTarget(
  call: DeferredCallSite,
  lookups: ReadonlyMap<string, readonly string[]>,
  bindingsByFile: ReadonlyMap<string, readonly ImportBinding[]>,
): string | undefined {
  const parts = call.expression.split(".");
  const calledName = parts.at(-1) ?? call.expression;
  const qualifier = parts.length > 1 ? parts.at(-2) : undefined;

  if (!qualifier || qualifier === "this") {
    const local = lookupTarget(lookups, call.sourceFilePath, calledName);
    if (local) return local;
  }

  if (qualifier) {
    const localMethod = lookupTarget(
      lookups,
      call.sourceFilePath,
      `${qualifier}.${calledName}`,
    );
    if (localMethod) return localMethod;
    if (qualifier === "this" && call.ownerName.includes(".")) {
      const className = call.ownerName.split(".")[0];
      const ownerMethod = lookupTarget(
        lookups,
        call.sourceFilePath,
        `${className}.${calledName}`,
      );
      if (ownerMethod) return ownerMethod;
    }
  }

  const requestedName = qualifier ?? calledName;
  const bindings = bindingsByFile.get(call.sourceFilePath) ?? [];
  let declarationOrder = -1;
  let declarationBindings: ImportBinding[] = [];
  const declarationMatches = (): boolean => declarationBindings.some((candidate) =>
    candidate.kind === "named"
      ? candidate.localName === requestedName || candidate.importedName === requestedName
      : candidate.localName === requestedName
  );
  const resolveDeclaration = (): string | undefined => {
    const named = declarationBindings.find(
      (binding) => binding.kind === "named"
        && (binding.localName === requestedName || binding.importedName === requestedName),
    );
    if (named) {
      return lookupTarget(lookups, named.targetFilePath, named.importedName);
    }
    const defaultBinding = declarationBindings.find(
      (binding) => binding.kind === "default" && binding.localName === requestedName,
    );
    if (defaultBinding) {
      return lookupTarget(lookups, defaultBinding.targetFilePath, "default")
        ?? lookupTarget(lookups, defaultBinding.targetFilePath, defaultBinding.localName);
    }
    return undefined;
  };

  for (const binding of bindings) {
    if (declarationOrder !== -1 && binding.declarationOrder !== declarationOrder) {
      const target = resolveDeclaration();
      if (target || declarationMatches()) return target;
      declarationBindings = [];
    }
    declarationOrder = binding.declarationOrder;
    declarationBindings.push(binding);
  }
  return resolveDeclaration();
}

/**
 * Resolve deferred call sites against AST-free global symbol and import indexes.
 *
 * @param fragment Combined project fragments to resolve.
 * @returns Resolved and unresolved call nodes and edges.
 */
export function resolveDeferredCalls(fragment: ProjectGraphFragment): ScanResult {
  const lookups = new Map<string, string[]>();
  for (const lookup of fragment.symbolLookups) {
    const key = fileAndNameKey(lookup.filePath, lookup.lookupName);
    const targets = lookups.get(key);
    if (targets) targets.push(lookup.targetId);
    else lookups.set(key, [lookup.targetId]);
  }
  for (const targets of lookups.values()) targets.sort();

  const bindingsByFile = new Map<string, ImportBinding[]>();
  for (const binding of fragment.importBindings) {
    const bindings = bindingsByFile.get(binding.sourceFilePath);
    if (bindings) bindings.push(binding);
    else bindingsByFile.set(binding.sourceFilePath, [binding]);
  }
  for (const bindings of bindingsByFile.values()) {
    bindings.sort((left, right) =>
      left.declarationOrder - right.declarationOrder
      || left.bindingOrder - right.bindingOrder
      || left.kind.localeCompare(right.kind)
    );
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const unresolvedById = new Set<string>();
  for (const call of [...fragment.deferredCalls].sort((left, right) =>
    left.sourceFilePath.localeCompare(right.sourceFilePath)
    || left.callStart - right.callStart
    || left.ownerId.localeCompare(right.ownerId)
  )) {
    const targetId = resolveDeferredCallTarget(call, lookups, bindingsByFile);
    if (targetId) {
      addEdge(edges, call.ownerId, targetId, "calls", {
        resolution: "resolved",
        expression: call.expression,
      });
      continue;
    }

    const unresolvedId = `unresolved-call:${call.sourceFilePath}:${call.callStart}`;
    if (!unresolvedById.has(unresolvedId)) {
      nodes.push({
        id: unresolvedId,
        type: "function",
        name: call.expression,
        filePath: "",
        lineStart: call.lineStart,
        lineEnd: call.lineEnd,
        tags: ["unresolved", "dynamic"],
      });
      unresolvedById.add(unresolvedId);
    }
    addEdge(edges, call.ownerId, unresolvedId, "calls", {
      resolution: "unresolved",
      expression: call.expression,
    });
  }
  return { nodes, edges };
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

/**
 * Extract an AST-free graph fragment from one TypeScript project.
 *
 * @param project Project whose currently loaded source files are scanned.
 * @param packageMap Optional file-to-package ownership map.
 * @param resolveModule Optional module resolver for files outside this Project.
 * @param observeStage Optional timing and resident-memory observer.
 * @returns A graph fragment containing no ts-morph objects.
 */
export function extractProjectGraph(
  project: Project,
  packageMap?: Map<string, string>,
  resolveModule?: ModuleResolver,
  observeStage?: ScanStageObserver,
): ProjectGraphFragment {
  const primaryStarted = performance.now();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const indexes: SymbolIndexes = {
    byDeclaration: new Map(),
    byFileAndName: new Map(),
    nameFamilyCounts: new Map(),
  };
  const sourceFiles = [...project.getSourceFiles()].sort(
    (left, right) => left.getFilePath().localeCompare(right.getFilePath()),
  );

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
      const functionName = declaration.getName()
        ?? (declaration.isDefaultExport() ? "default" : "anonymous");
      addSymbol(
        indexes,
        nodes,
        edges,
        declaration,
        sourceFile,
        "function",
        functionName,
        packageId,
        declaration.isExported(),
        fileId,
        "function",
        declaration.getBody(),
      );
    }

    for (const statement of sourceFile.getVariableStatements()) {
      for (const declaration of statement.getDeclarations()) {
        const initializer = declaration.getInitializer();
        if (
          !initializer
          || (
            initializer.getKind() !== SyntaxKind.ArrowFunction
            && initializer.getKind() !== SyntaxKind.FunctionExpression
          )
        ) continue;
        const functionNode = addSymbol(
          indexes,
          nodes,
          edges,
          initializer,
          sourceFile,
          "function",
          declaration.getName(),
          packageId,
          statement.isExported(),
          fileId,
          initializer.getKind() === SyntaxKind.ArrowFunction
            ? "arrow_function"
            : "function_expression",
          initializer,
        );
        if (!getJsDocs(initializer).length && getJsDocs(statement).length) {
          addDocumentationNodeFields(functionNode, statement, "variable_function");
        }
      }
    }

    for (const cls of sourceFile.getClasses()) {
      const classNode = addSymbol(
        indexes,
        nodes,
        edges,
        cls,
        sourceFile,
        "class",
        cls.getName() ?? "anonymous",
        packageId,
        cls.isExported(),
        fileId,
        "class",
      );
      const classExported = cls.isExported();
      for (const method of cls.getMethods()) {
        const methodNode = addSymbol(
          indexes,
          nodes,
          edges,
          method,
          sourceFile,
          "function",
          methodNodeName(cls, method),
          packageId,
          classExported && isPublicMethod(method),
          classNode.id,
          "public_method",
          method.getBody(),
          isPublicMethod(method) ? ["public"] : ["internal"],
        );
        if (!getJsDocs(method).length && classExported && isPublicMethod(method)) {
          methodNode.tags = Array.from(new Set([...(methodNode.tags ?? []), "public"]));
        }
      }
      for (const ctor of cls.getConstructors()) {
        addSymbol(
          indexes,
          nodes,
          edges,
          ctor,
          sourceFile,
          "function",
          `${cls.getName() ?? "anonymous"}.constructor`,
          packageId,
          classExported,
          classNode.id,
          "constructor",
          ctor.getBody(),
          ["constructor"],
        );
      }
    }

    for (const iface of sourceFile.getInterfaces()) {
      addSymbol(
        indexes,
        nodes,
        edges,
        iface,
        sourceFile,
        "interface",
        iface.getName(),
        packageId,
        iface.isExported(),
        fileId,
        "interface",
      );
      for (const ext of iface.getExtends()) {
        addEdge(
          edges,
          `interface:${filePath}:${iface.getName()}`,
          `interface:*:${ext.getExpression().getText()}`,
          "extends",
        );
      }
    }

    for (const alias of sourceFile.getTypeAliases()) {
      addSymbol(
        indexes,
        nodes,
        edges,
        alias,
        sourceFile,
        "type_alias",
        alias.getName(),
        packageId,
        alias.isExported(),
        fileId,
        "type_alias",
      );
    }

    for (const cls of sourceFile.getClasses()) {
      const classId = `class:${filePath}:${cls.getName() ?? "anonymous"}`;
      const ext = cls.getExtends();
      if (ext) {
        addEdge(
          edges,
          classId,
          `class:*:${ext.getExpression().getText()}`,
          "extends",
        );
      }
      for (const impl of cls.getImplements()) {
        addEdge(
          edges,
          classId,
          `interface:*:${impl.getExpression().getText()}`,
          "implements",
        );
      }
    }

    for (const declaration of sourceFile.getImportDeclarations()) {
      const resolved = resolveImportedPath(
        sourceFile,
        declaration.getModuleSpecifierValue(),
        resolveModule,
      );
      if (resolved) addEdge(edges, fileId, `file:${resolved}`, "imports");
    }
  }

  sortSymbolLookups(indexes);
  const symbolLookups = extractSymbolLookups(indexes);
  const importBindings = extractImportBindings(sourceFiles, resolveModule);
  const deferredCalls = extractDeferredCalls(sourceFiles, indexes);
  indexes.byDeclaration.clear();
  indexes.byFileAndName.clear();
  indexes.nameFamilyCounts.clear();
  emitStage("primary_extraction", primaryStarted, observeStage);

  const packageIdFor = (filePath: string) => packageMap?.get(filePath) ?? "root";
  const appendPass = (pass: ScanResult): void => {
    nodes.push(...pass.nodes.map((node) => ({
      ...node,
      packageId: node.packageId
        ?? (node.filePath ? packageIdFor(node.filePath) : undefined),
    })));
    edges.push(...pass.edges);
  };
  const runPass = (
    stage: ScanStageName,
    pass: () => ScanResult,
  ): void => {
    const startedAt = performance.now();
    appendPass(pass());
    emitStage(stage, startedAt, observeStage);
  };
  runPass("schema_pass", () => scanSchemas(project, packageMap));
  runPass("framework_pass", () => scanFrameworkEdges(project, packageMap));
  runPass("string_literal_pass", () => scanStringLiterals(project, packageMap));
  runPass("param_flow_pass", () => scanParamFlow(project, packageMap));
  runPass("route_pass", () => scanRoutes(project, packageMap));

  return { nodes, edges, symbolLookups, importBindings, deferredCalls };
}

/**
 * Resolve and normalize one or more combined AST-free project fragments.
 *
 * @param fragment Combined fragment data from every project batch.
 * @param observeStage Optional timing and resident-memory observer.
 * @returns Nodes and edges sorted and deduplicated for persistence.
 */
export function finalizeProjectGraph(
  fragment: ProjectGraphFragment,
  observeStage?: ScanStageObserver,
): ScanResult {
  const callStarted = performance.now();
  const calls = resolveDeferredCalls(fragment);
  emitStage("call_resolution", callStarted, observeStage);
  const nodes = [...fragment.nodes, ...calls.nodes];
  const edges = [...fragment.edges, ...calls.edges];
  const knownIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (knownIds.has(edge.target) || !edge.target.includes(":*:")) continue;
    const [type, , ...nameParts] = edge.target.split(":");
    const placeholder: GraphNode = {
      id: edge.target,
      type: type as GraphNode["type"],
      name: nameParts.join(":"),
      filePath: "",
      tags: ["unresolved"],
    };
    nodes.push(placeholder);
    knownIds.add(placeholder.id);
  }
  const deduplicationStarted = performance.now();
  const result = deduplicateAndSort({ nodes, edges });
  emitStage("deduplication", deduplicationStarted, observeStage);
  return result;
}

/**
 * Scan a TypeScript project into a deterministic graph snapshot.
 *
 * @param project Project whose source files are scanned.
 * @param packageMap Optional file-to-package ownership map.
 * @param observeStage Optional timing and resident-memory observer.
 * @returns Nodes and edges sorted and deduplicated for persistence.
 */
export function scanProject(
  project: Project,
  packageMap?: Map<string, string>,
  observeStage?: ScanStageObserver,
): ScanResult {
  return finalizeProjectGraph(
    extractProjectGraph(project, packageMap, undefined, observeStage),
    observeStage,
  );
}
