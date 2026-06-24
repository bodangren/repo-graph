/**
 * CLI Contract — Type definitions for the build-graph command-line interface.
 *
 * These types are the source of truth for argument shapes, exit codes,
 * and output formats across all subcommands.
 */

// ── Subcommands ────────────────────────────────────────────────────────────

export type Subcommand = "init" | "scan" | "update" | "query" | "search" | "deps" | "callers" | "path" | "stats" | "files" | "help" | "version" | "inspect" | "audit" | "config" | "explore" | "affected" | "impact";

// ── Per-subcommand argument shapes ─────────────────────────────────────────

export interface InitArgs {
  dbPath: string;
}

export interface ScanArgs {
  projectDir: string;
  dbPath: string;
  configPath?: string;
  includePatterns?: string[];
}

export interface UpdateArgs {
  dbPath: string;
  filePaths: string[];
}

export interface QueryArgs {
  dbPath: string;
  sql: string;
  json?: boolean;
}

export interface DepsArgs {
  dbPath: string;
  name: string;
  downstream: boolean;
  json?: boolean;
  limit?: number;
  depth?: number;
  fromPackage?: string;
  toPackage?: string;
}

export interface CallersArgs {
  dbPath: string;
  name: string;
  json?: boolean;
  limit?: number;
  depth?: number;
  fromPackage?: string;
  toPackage?: string;
}

export interface PathArgs {
  dbPath: string;
  from: string;
  to: string;
  json?: boolean;
}

export interface StatsArgs {
  dbPath: string;
  json?: boolean;
}

export interface FilesArgs {
  dbPath: string;
  pattern?: string;
  json?: boolean;
  limit?: number;
}

export interface SearchArgs {
  dbPath: string;
  keyword: string;
  json?: boolean;
  limit?: number;
  type?: string;
}

export interface HelpArgs {
  subcommand?: Subcommand;
}

export interface VersionArgs {}

export interface InspectArgs {
  dbPath: string;
  name: string;
  json?: boolean;
}

export interface AuditArgs {
  dbPath: string;
  json?: boolean;
}

// ── Explore / Affected / Impact argument shapes ─────────────────────────────

export interface ExploreArgs {
  dbPath: string;
  query: string;
  json?: boolean;
  limit?: number;
  depth?: number;
  includeSource?: boolean;
}

export interface AffectedArgs {
  dbPath: string;
  files: string[];
  stdin?: boolean;
  json?: boolean;
  depth?: number;
  testsOnly?: boolean;
  filter?: string;
}

export interface ImpactArgs {
  dbPath: string;
  nodeOrFile: string;
  json?: boolean;
  depth?: number;
  edgeType?: string;
  includeSource?: boolean;
}

// ── Union of all possible parsed argument sets ─────────────────────────────

export type ParsedArgs =
  | { subcommand: "init"; args: InitArgs }
  | { subcommand: "scan"; args: ScanArgs }
  | { subcommand: "update"; args: UpdateArgs }
  | { subcommand: "query"; args: QueryArgs }
  | { subcommand: "search"; args: SearchArgs }
  | { subcommand: "deps"; args: DepsArgs }
  | { subcommand: "callers"; args: CallersArgs }
  | { subcommand: "path"; args: PathArgs }
  | { subcommand: "stats"; args: StatsArgs }
  | { subcommand: "files"; args: FilesArgs }
  | { subcommand: "help"; args: HelpArgs }
  | { subcommand: "version"; args: VersionArgs }
  | { subcommand: "inspect"; args: InspectArgs }
  | { subcommand: "audit"; args: AuditArgs }
  | { subcommand: "explore"; args: ExploreArgs }
  | { subcommand: "affected"; args: AffectedArgs }
  | { subcommand: "impact"; args: ImpactArgs }
  | { subcommand: "config"; args: {} };

// ── Exit codes ─────────────────────────────────────────────────────────────

export const ExitCode = {
  Success: 0,
  NotFound: 1,
  Ambiguous: 2,
  Misuse: 3,
  RuntimeError: 4,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// ── Progress output (stderr) ───────────────────────────────────────────────

export interface ScanProgress {
  filesScanned: number;
  nodesExtracted: number;
  edgesExtracted: number;
  elapsedMs: number;
}

export interface UpdateProgress {
  filesUpdated: number;
  nodesDeleted: number;
  nodesInserted: number;
  edgesDeleted: number;
  edgesInserted: number;
}

// ── Scanner output contract ────────────────────────────────────────────────

/**
 * Node ID format: `<type>:<file_path>:<name>`
 * For file nodes, the name is omitted: `file:<file_path>`
 */
export type NodeId = string;

export interface GraphNode {
  id: NodeId;
  type: NodeType;
  name: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  summary?: string;
  tags?: string[];
  complexity?: "simple" | "moderate" | "complex";
  languageNotes?: string;
  layerId?: string;
  packageId?: string;
}

export type NodeType =
  | "file"
  | "function"
  | "class"
  | "interface"
  | "type_alias"
  | "variable"
  | "import"
  | "export"
  | "schema"
  | "field"
  | "route"
  | "param";

export interface GraphEdge {
  source: NodeId;
  target: NodeId;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  weight?: number;
  metadata?: string;
}

export type EdgeType =
  | "contains"
  | "imports"
  | "extends"
  | "implements"
  | "calls"
  | "depends_on"
  | "exports"
  | "tested_by"
  | "has_field"
  | "references"
  | "renders"
  | "uses_hook"
  | "queries"
  | "mutates"
  | "param_flow";

// ── Config types ──────────────────────────────────────────────────────────

export interface CustomEdgeDef {
  type: string;
  description?: string;
  sourceType: NodeType;
  targetType: NodeType;
  pattern: {
    sourceImport?: string;
    targetName?: string;
  };
  scope?: "same-file" | "imported" | "all";
}

export interface BuildGraphConfig {
  customEdges?: CustomEdgeDef[];
}

// ── Query/Search output contract ───────────────────────────────────────────

export interface TableColumn {
  name: string;
  width: number;
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
}

export interface SearchResult {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  summary?: string;
}

// ── Explore / Affected / Impact output types ────────────────────────────────

/** Freshness status for a single file relative to its indexed_at timestamp. */
export interface FileFreshnessEntry {
  path: string;
  status: "current" | "stale" | "missing";
  indexedAt?: number;
  modifiedAt?: number;
}

/** Freshness block attached to explore/impact JSON output. */
export interface FreshnessBlock {
  stale: string[];
  missing: string[];
  checkedAt: number;
}

/** A direct relationship surfaced by explore or impact. */
export interface RelationshipEntry {
  sourceId: string;
  targetId: string;
  edgeType: EdgeType;
  direction: "forward" | "backward";
  targetName: string;
  targetFilePath: string;
  targetType: NodeType;
}

/** A bounded source-code excerpt with stable line numbers. */
export interface SourceSnippet {
  nodeId: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  truncated: boolean;
}

/** Group name for affected-file output classification. */
export type AffectedGroup = "tests" | "routes" | "components" | "dataAccess" | "other";

/** A single affected file with its classification group and provenance paths. */
export interface AffectedFileEntry {
  path: string;
  group: AffectedGroup;
  paths: string[][];
}

/** Top-level JSON output for `build-graph explore`. */
export interface ExploreOutput {
  query: string;
  matches: SearchResult[];
  relationships: RelationshipEntry[];
  sourceSnippets: SourceSnippet[];
  freshness: FreshnessBlock;
  truncated: boolean;
  nextQuery?: string;
}

/** Top-level JSON output for `build-graph affected`. */
export interface AffectedOutput {
  changedFiles: string[];
  affected: AffectedFileEntry[];
  truncated: boolean;
  testsOnly: boolean;
}

/** Top-level JSON output for `build-graph impact`. */
export interface ImpactOutput {
  root: string;
  relationships: RelationshipEntry[];
  affectedTests: string[];
  freshness: FreshnessBlock;
  truncated: boolean;
  nextQuery?: string;
}

// ── Ranking and output budgets ──────────────────────────────────────────────

/**
 * Match scoring order for explore search results.
 * Lower index = higher priority. Implementation must break ties using the
 * next criterion in the list.
 */
export const MATCH_SCORING_ORDER = [
  "exact_node_name",
  "file_path",
  "fts_rank",
  "tags",
  "relationship_proximity",
] as const;

/** Default limits for explore/affected/impact output. */
export const OutputLimits = {
  /** Maximum number of search matches returned. */
  matches: 20,
  /** Maximum number of relationship entries per match or traversal hop. */
  relationshipFanout: 50,
  /** Maximum traversal depth for affected/impact edge walks. */
  traversalDepth: 3,
  /** Maximum lines in a source snippet excerpt. */
  sourceSnippetLines: 10,
} as const;

/**
 * Metadata appended to output when truncation occurs.
 * Implementation must include this in JSON output and suggest next-query
 * guidance in text output.
 */
export interface TruncationMeta {
  truncated: boolean;
  totalAvailable: number;
  returned: number;
  nextQuery?: string;
}

// ── Affected/impact traversal semantics ─────────────────────────────────────

/**
 * Edge types counted for reverse impact traversal.
 * Only these edge types are walked when computing the blast radius of a
 * changed file or symbol.
 */
export const IMPACT_TRAVERSAL_EDGE_TYPES: readonly EdgeType[] = [
  "imports",
  "calls",
  "references",
  "renders",
  "queries",
  "mutates",
  "param_flow",
  "uses_hook",
  "tested_by",
] as const;

/**
 * Default glob patterns for test-file classification.
 * Files matching any of these patterns are placed in the `tests` group.
 */
export const TEST_FILE_PATTERNS: readonly string[] = [
  "*.test.ts",
  "*.test.tsx",
  "*.spec.ts",
  "*.spec.tsx",
  "__tests__/**",
  "e2e/**",
  "playwright/**",
] as const;

/**
 * Output group names for affected-file classification.
 * The order defines display priority in text output.
 */
export const AFFECTED_GROUP_NAMES: readonly AffectedGroup[] = [
  "tests",
  "routes",
  "components",
  "dataAccess",
  "other",
] as const;
