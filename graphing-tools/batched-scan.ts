import { readFileSync, readdirSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import { Project, ts } from "ts-morph";
import {
  extractProjectGraph,
  finalizeProjectGraph,
  type DeferredCallSite,
  type ImportBinding,
  type ModuleResolver,
  type ProjectGraphFragment,
  type ScanStageDiagnostic,
  type SymbolLookupEntry,
} from "./scanner-core";
import type { GraphEdge, GraphNode } from "./contract";
import type { GraphSnapshot } from "./persistence";

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  "out",
  "coverage",
]);
const MAX_SOURCE_FILES_PER_BATCH = 32;


/** One deterministic TypeScript configuration batch. */
export interface ProjectBatch {
  tsConfigPath: string;
  filePaths: string[];
  compilerOptions: ts.CompilerOptions;
}

/** Complete AST-free plan for a package-batched scan. */
export interface ProjectBatchPlan {
  projectRoot: string;
  tsConfigPaths: string[];
  filePaths: string[];
  packageMap: Map<string, string>;
  batches: ProjectBatch[];
}

/** Timing and memory evidence captured after one batch extraction. */
export interface BatchScanDiagnostic {
  tsConfigPath: string;
  fileCount: number;
  batchIndex: number;
  batchCount: number;
  elapsedMs: number;
  rssBytes: number;
}

/** Scanner stage diagnostic enriched with optional batch ownership. */
export interface BatchedStageDiagnostic extends ScanStageDiagnostic {
  tsConfigPath?: string;
  batchIndex?: number;
  batchCount?: number;
}

/** Result of scanning all TypeScript configuration boundaries sequentially. */
export interface BatchedProjectScan {
  snapshot: GraphSnapshot;
  filePaths: string[];
  tsConfigPaths: string[];
  maxActiveProjects: number;
  diagnostics: BatchScanDiagnostic[];
  stageDiagnostics: BatchedStageDiagnostic[];
}

/** Optional lifecycle hooks used to verify sequential Project ownership. */
export interface BatchedScanHooks {
  onProjectOpened?: (tsConfigPath: string, activeProjects: number) => void;
  onProjectReleased?: (tsConfigPath: string, activeProjects: number) => void;
  onBatchCompleted?: (diagnostic: BatchScanDiagnostic) => void;
  onStageCompleted?: (diagnostic: BatchedStageDiagnostic) => void;
}

interface ParsedConfig {
  tsConfigPath: string;
  directory: string;
  filePaths: string[];
  compilerOptions: ts.CompilerOptions;
}

function discoverTsConfigs(root: string): string[] {
  const results: string[] = [];
  const walk = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "tsconfig.json") results.push(resolve(path));
    }
  };
  walk(root);
  return results.sort();
}

function diagnosticText(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function parseConfig(tsConfigPath: string): ParsedConfig {
  const read = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(diagnosticText(read.error));
  }
  const directory = dirname(tsConfigPath);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    directory,
    undefined,
    tsConfigPath,
  );
  const errors = parsed.errors.filter((diagnostic) => diagnostic.code !== 18003);
  if (errors.length > 0) {
    throw new Error(errors.map(diagnosticText).join("; "));
  }
  const filePaths = parsed.fileNames
    .map((filePath) => resolve(filePath))
    .filter((filePath) => /\.[cm]?[jt]sx?$/.test(filePath))
    .sort();
  return {
    tsConfigPath,
    directory,
    filePaths: Array.from(new Set(filePaths)),
    compilerOptions: parsed.options,
  };
}

function directoryDepth(path: string): number {
  return resolve(path).split("/").length;
}

function packageIdForFile(filePath: string, tsConfigPaths: readonly string[]): string {
  let bestPath: string | undefined;
  let bestDepth = -1;
  for (const tsConfigPath of tsConfigPaths) {
    const configDirectory = dirname(tsConfigPath);
    const fileDirectory = dirname(filePath);
    if (
      fileDirectory !== configDirectory
      && !fileDirectory.startsWith(configDirectory + "/")
    ) continue;
    const depth = directoryDepth(configDirectory);
    if (
      depth > bestDepth
      || (depth === bestDepth && tsConfigPath.localeCompare(bestPath ?? "") < 0)
    ) {
      bestPath = tsConfigPath;
      bestDepth = depth;
    }
  }
  return bestPath ? basename(dirname(bestPath)) : "root";
}

function chooseOwner(configs: readonly ParsedConfig[]): ParsedConfig {
  return [...configs].sort((left, right) =>
    directoryDepth(right.directory) - directoryDepth(left.directory)
    || left.tsConfigPath.localeCompare(right.tsConfigPath)
  )[0];
}

/**
 * Plan deterministic, non-overlapping project batches without creating ASTs.
 *
 * @param projectRoot Monorepo root containing TypeScript configurations.
 * @returns Sorted source ownership, package mapping, and batch definitions.
 * @throws When a discovered TypeScript configuration cannot be parsed.
 */
export function planProjectBatches(projectRoot: string): ProjectBatchPlan {
  const absoluteRoot = resolve(projectRoot);
  const tsConfigPaths = discoverTsConfigs(absoluteRoot);
  const configs = tsConfigPaths.map((tsConfigPath) => {
    try {
      return parseConfig(tsConfigPath);
    } catch (error) {
      throw new Error(
        `Could not parse TypeScript configuration ${tsConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
  const claimants = new Map<string, ParsedConfig[]>();
  for (const config of configs) {
    for (const filePath of config.filePaths) {
      const existing = claimants.get(filePath);
      if (existing) existing.push(config);
      else claimants.set(filePath, [config]);
    }
  }

  const ownedByConfig = new Map<string, string[]>();
  for (const [filePath, candidates] of claimants) {
    const owner = chooseOwner(candidates);
    const paths = ownedByConfig.get(owner.tsConfigPath);
    if (paths) paths.push(filePath);
    else ownedByConfig.set(owner.tsConfigPath, [filePath]);
  }
  const batches = configs
    .filter((config) => (ownedByConfig.get(config.tsConfigPath)?.length ?? 0) > 0)
    .flatMap((config) => {
      const ownedFiles = [...(ownedByConfig.get(config.tsConfigPath) ?? [])].sort();
      const chunks: ProjectBatch[] = [];
      for (
        let offset = 0;
        offset < ownedFiles.length;
        offset += MAX_SOURCE_FILES_PER_BATCH
      ) {
        chunks.push({
          tsConfigPath: config.tsConfigPath,
          filePaths: ownedFiles.slice(offset, offset + MAX_SOURCE_FILES_PER_BATCH),
          compilerOptions: config.compilerOptions,
        });
      }
      return chunks;
    })
    .sort((left, right) =>
      left.tsConfigPath.localeCompare(right.tsConfigPath)
      || (left.filePaths[0] ?? "").localeCompare(right.filePaths[0] ?? "")
    );
  const filePaths = Array.from(claimants.keys()).sort();
  const packageMap = new Map(filePaths.map((filePath) => [
    filePath,
    packageIdForFile(filePath, tsConfigPaths),
  ]));
  return { projectRoot: absoluteRoot, tsConfigPaths, filePaths, packageMap, batches };
}

function createModuleResolver(
  compilerOptions: ts.CompilerOptions,
  plannedFiles: ReadonlySet<string>,
): ModuleResolver {
  const canonicalFileName = ts.sys.useCaseSensitiveFileNames
    ? (fileName: string) => fileName
    : (fileName: string) => fileName.toLowerCase();
  const resolutionCache = ts.createModuleResolutionCache(
    process.cwd(),
    canonicalFileName,
    compilerOptions,
  );
  const memo = new Map<string, string | undefined>();
  return (sourceFilePath, specifier) => {
    const key = `${sourceFilePath}\u0000${specifier}`;
    if (memo.has(key)) return memo.get(key);
    const resolvedModule = ts.resolveModuleName(
      specifier,
      sourceFilePath,
      compilerOptions,
      ts.sys,
      resolutionCache,
    ).resolvedModule;
    const target = resolvedModule
      ? resolve(resolvedModule.resolvedFileName)
      : undefined;
    const result = target && plannedFiles.has(target) ? target : undefined;
    memo.set(key, result);
    return result;
  };
}

function releaseProject(project: Project): void {
  for (const sourceFile of [...project.getSourceFiles()]) {
    project.removeSourceFile(sourceFile);
  }
}

function forceGarbageCollection(): void {
  const bun = (globalThis as typeof globalThis & {
    Bun?: { gc?: (force?: boolean) => void };
  }).Bun;
  bun?.gc?.(true);
}

function mergeFragment(
  target: ProjectGraphFragment,
  fragment: ProjectGraphFragment,
  nodes: Map<string, GraphNode>,
  edges: Map<string, GraphEdge>,
): void {
  for (const node of fragment.nodes) nodes.set(node.id, node);
  for (const edge of fragment.edges) {
    const key = `${edge.source}\u0000${edge.target}\u0000${edge.type}\u0000${edge.metadata ?? ""}`;
    edges.set(key, edge);
  }
  target.symbolLookups.push(...fragment.symbolLookups);
  target.importBindings.push(...fragment.importBindings);
  target.deferredCalls.push(...fragment.deferredCalls);
}

/**
 * Scan TypeScript configurations sequentially and resolve calls globally.
 *
 * @param projectRoot Monorepo root containing TypeScript configurations.
 * @param hooks Optional lifecycle observers for sequentiality verification.
 * @returns A deterministic graph snapshot and the exact scanned source set.
 * @throws When planning or extracting any batch fails.
 */
export async function scanProjectBatches(
  projectRoot: string,
  hooks: BatchedScanHooks = {},
): Promise<BatchedProjectScan> {
  const stageDiagnostics: BatchedStageDiagnostic[] = [];
  const emitStage = (
    diagnostic: ScanStageDiagnostic,
    context: Omit<BatchedStageDiagnostic, keyof ScanStageDiagnostic> = {},
  ): void => {
    const enriched = { ...diagnostic, ...context };
    stageDiagnostics.push(enriched);
    hooks.onStageCompleted?.(enriched);
  };
  const discoveryStarted = performance.now();
  const plan = planProjectBatches(projectRoot);
  emitStage({
    stage: "project_discovery",
    elapsedMs: Math.round(performance.now() - discoveryStarted),
    rssBytes: process.memoryUsage().rss,
  });
  const plannedFiles = new Set(plan.filePaths);
  const moduleResolvers = new Map<string, ModuleResolver>();
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const combined: ProjectGraphFragment = {
    nodes: [],
    edges: [],
    symbolLookups: [] as SymbolLookupEntry[],
    importBindings: [] as ImportBinding[],
    deferredCalls: [] as DeferredCallSite[],
  };
  let activeProjects = 0;
  let maxActiveProjects = 0;
  const diagnostics: BatchScanDiagnostic[] = [];

  for (const [batchIndex, batch] of plan.batches.entries()) {
    const batchStarted = performance.now();
    let project: Project | undefined;
    let opened = false;
    try {
      project = new Project({
        compilerOptions: batch.compilerOptions,
        useInMemoryFileSystem: true,
        skipFileDependencyResolution: true,
        skipLoadingLibFiles: true,
      });
      for (const filePath of batch.filePaths) {
        project.createSourceFile(filePath, readFileSync(filePath, "utf8"));
      }
      opened = true;
      activeProjects++;
      maxActiveProjects = Math.max(maxActiveProjects, activeProjects);
      hooks.onProjectOpened?.(batch.tsConfigPath, activeProjects);
      const packageMap = new Map(batch.filePaths.map((filePath) => [
        filePath,
        plan.packageMap.get(filePath) ?? "root",
      ]));
      let moduleResolver = moduleResolvers.get(batch.tsConfigPath);
      if (!moduleResolver) {
        moduleResolver = createModuleResolver(batch.compilerOptions, plannedFiles);
        moduleResolvers.set(batch.tsConfigPath, moduleResolver);
      }
      const fragment = extractProjectGraph(
        project,
        packageMap,
        moduleResolver,
        (diagnostic) => emitStage(diagnostic, {
          tsConfigPath: batch.tsConfigPath,
          batchIndex: batchIndex + 1,
          batchCount: plan.batches.length,
        }),
      );
      mergeFragment(combined, fragment, nodeMap, edgeMap);
      const diagnostic: BatchScanDiagnostic = {
        tsConfigPath: batch.tsConfigPath,
        fileCount: batch.filePaths.length,
        batchIndex: batchIndex + 1,
        batchCount: plan.batches.length,
        elapsedMs: Math.round(performance.now() - batchStarted),
        rssBytes: process.memoryUsage().rss,
      };
      diagnostics.push(diagnostic);
      hooks.onBatchCompleted?.(diagnostic);
    } catch (error) {
      throw new Error(
        `Could not scan TypeScript configuration ${batch.tsConfigPath}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      if (project) releaseProject(project);
      project = undefined;
      forceGarbageCollection();
      if (opened) {
        activeProjects--;
        hooks.onProjectReleased?.(batch.tsConfigPath, activeProjects);
      }
    }
  }

  combined.nodes = Array.from(nodeMap.values());
  combined.edges = Array.from(edgeMap.values());
  const snapshot = finalizeProjectGraph(
    combined,
    (diagnostic) => emitStage(diagnostic),
  );
  return {
    snapshot,
    filePaths: plan.filePaths,
    tsConfigPaths: plan.tsConfigPaths,
    maxActiveProjects,
    diagnostics,
    stageDiagnostics,
  };
}
