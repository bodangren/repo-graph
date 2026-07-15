/**
 * CLI Contract — Type definitions for the repo-graph command-line interface.
 *
 * These types are the source of truth for argument shapes, exit codes,
 * and output formats across all subcommands.
 */

// ── Subcommands ────────────────────────────────────────────────────────────

/** Supported repo-graph subcommands. */
export type Subcommand = "init" | "scan" | "update" | "query" | "search" | "deps" | "callers" | "path" | "stats" | "files" | "help" | "version" | "inspect" | "audit" | "config" | "explore" | "affected" | "impact" | "install-hooks";

// ── Per-subcommand argument shapes ─────────────────────────────────────────

/** Arguments for graph initialization. */
export interface InitArgs {
  dbPath: string;
}

/** Arguments for a full source scan. */
export interface ScanArgs {
  projectDir: string;
  dbPath: string;
  configPath?: string;
  includePatterns?: string[];
}

/** Arguments for a graph update. */
export interface UpdateArgs {
  dbPath: string;
  filePaths: string[];
  json?: boolean;
}

/** Arguments for hook installation. */
export interface InstallHooksArgs {
  path?: string;
  force?: boolean;
  json?: boolean;
}

/** Arguments for a raw SQL query. */
export interface QueryArgs {
  dbPath: string;
  sql: string;
  json?: boolean;
}

/** Arguments for dependency traversal. */
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

/** Arguments for caller traversal. */
export interface CallersArgs {
  dbPath: string;
  name: string;
  json?: boolean;
  limit?: number;
  depth?: number;
  fromPackage?: string;
  toPackage?: string;
}

/** Arguments for shortest-path lookup. */
export interface PathArgs {
  dbPath: string;
  from: string;
  to: string;
  json?: boolean;
}

/** Arguments for graph statistics. */
export interface StatsArgs {
  dbPath: string;
  json?: boolean;
}

/** Arguments for file listing. */
export interface FilesArgs {
  dbPath: string;
  pattern?: string;
  json?: boolean;
  limit?: number;
}

/** Arguments for node search. */
export interface SearchArgs {
  dbPath: string;
  keyword: string;
  json?: boolean;
  limit?: number;
  type?: string;
}

/** Arguments for help output. */
export interface HelpArgs {
  subcommand?: Subcommand;
}

/** Arguments for version output. */
export interface VersionArgs {}

/** Arguments for node inspection. */
export interface InspectArgs {
  dbPath: string;
  name: string;
  json?: boolean;
}

/** Arguments for graph and documentation audits. */
export interface AuditArgs {
  dbPath: string;
  json?: boolean;
  docs?: boolean;
  includeInternal?: boolean;
}

// ── Explore / Affected / Impact argument shapes ─────────────────────────────

/** Arguments for high-signal graph exploration. */
export interface ExploreArgs {
  dbPath: string;
  query: string;
  json?: boolean;
  limit?: number;
  depth?: number;
  includeSource?: boolean;
}

/** Arguments for affected-file traversal. */
export interface AffectedArgs {
  dbPath: string;
  files: string[];
  stdin?: boolean;
  json?: boolean;
  depth?: number;
  testsOnly?: boolean;
  filter?: string;
}

/** Arguments for blast-radius traversal. */
export interface ImpactArgs {
  dbPath: string;
  nodeOrFile: string;
  json?: boolean;
  depth?: number;
  edgeType?: string;
  includeSource?: boolean;
  fromPackage?: string;
  toPackage?: string;
}

// ── Union of all possible parsed argument sets ─────────────────────────────

type ParsedArgsHints = Partial<InitArgs & ScanArgs & UpdateArgs & InstallHooksArgs & QueryArgs & DepsArgs & CallersArgs & PathArgs & StatsArgs & FilesArgs & SearchArgs & HelpArgs & InspectArgs & AuditArgs & ExploreArgs & AffectedArgs & ImpactArgs>;
type ParsedArgsFor<T> = T & ParsedArgsHints;

/** Discriminated union produced by CLI argument parsing. */
export type ParsedArgs =
  | { subcommand: "init"; args: ParsedArgsFor<InitArgs> }
  | { subcommand: "scan"; args: ParsedArgsFor<ScanArgs> }
  | { subcommand: "update"; args: ParsedArgsFor<UpdateArgs> }
  | { subcommand: "query"; args: ParsedArgsFor<QueryArgs> }
  | { subcommand: "search"; args: ParsedArgsFor<SearchArgs> }
  | { subcommand: "deps"; args: ParsedArgsFor<DepsArgs> }
  | { subcommand: "callers"; args: ParsedArgsFor<CallersArgs> }
  | { subcommand: "path"; args: ParsedArgsFor<PathArgs> }
  | { subcommand: "stats"; args: ParsedArgsFor<StatsArgs> }
  | { subcommand: "files"; args: ParsedArgsFor<FilesArgs> }
  | { subcommand: "help"; args: ParsedArgsFor<HelpArgs> }
  | { subcommand: "version"; args: ParsedArgsFor<VersionArgs> }
  | { subcommand: "inspect"; args: ParsedArgsFor<InspectArgs> }
  | { subcommand: "audit"; args: ParsedArgsFor<AuditArgs> }
  | { subcommand: "explore"; args: ParsedArgsFor<ExploreArgs> }
  | { subcommand: "affected"; args: ParsedArgsFor<AffectedArgs> }
  | { subcommand: "impact"; args: ParsedArgsFor<ImpactArgs> }
  | { subcommand: "install-hooks"; args: ParsedArgsFor<InstallHooksArgs> }
  | { subcommand: "config"; args: ParsedArgsFor<{}> };

// ── Exit codes ─────────────────────────────────────────────────────────────

export const ExitCode = {
  Success: 0,
  NotFound: 1,
  Ambiguous: 2,
  Misuse: 3,
  RuntimeError: 4,
} as const;

/** Numeric process exit-code value. */
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

// ── Progress output (stderr) ───────────────────────────────────────────────

/** Progress payload for a source scan. */
export interface ScanProgress {
  filesScanned: number;
  nodesExtracted: number;
  edgesExtracted: number;
  elapsedMs: number;
}

/** Progress payload for an update. */
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

/** A normalized JSDoc tag stored with a graph node. */
export interface DocumentationTag {
  name: string;
  text: string;
  subject?: string;
}

/** A structured parameter description extracted from a JSDoc block. */
export interface DocumentationParam {
  name: string;
  description: string;
}

/** Versioned documentation payload persisted with supported public nodes. */
export interface NodeDocumentation {
  version: 1;
  hasJsDoc: boolean;
  description: string;
  params: DocumentationParam[];
  returns?: string;
  tags: DocumentationTag[];
  declarationForm?: string;
}

/** Persisted graph node contract. */
export interface GraphNode {
  id: NodeId;
  type: NodeType;
  name: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  summary?: string;
  documentation?: NodeDocumentation;
  tags?: string[];
  complexity?: "simple" | "moderate" | "complex";
  languageNotes?: string;
  layerId?: string;
  packageId?: string;
}

/** Persisted node categories. */
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

/** Persisted graph edge contract. */
export interface GraphEdge {
  source: NodeId;
  target: NodeId;
  type: EdgeType | string;
  direction: "forward" | "backward" | "bidirectional";
  weight?: number;
  metadata?: string;
}

/** Built-in graph edge categories. */
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

/** Configuration for one custom graph edge type. */
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

/** Project configuration consumed by the scanner. */
export interface BuildGraphConfig {
  customEdges?: CustomEdgeDef[];
}

// ── Query/Search output contract ───────────────────────────────────────────

/** A rendered table column descriptor. */
export interface TableColumn {
  name: string;
  width: number;
}

/** Normalized raw-query output. */
export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
}

/** Search result for one persisted graph node. */
export interface SearchResult {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  summary?: string;
  documentation?: NodeDocumentation;
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
  edgeType: EdgeType | string;
  direction: "forward" | "backward";
  targetName: string;
  targetFilePath: string;
  targetType: NodeType;
  /** Number of persisted edges from the resolved root to this relationship. */
  depth?: number;
  /** Persisted node IDs visited from the resolved root, in traversal order. */
  path?: string[];
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

/** Top-level JSON output for `repo-graph explore`. */
export interface ExploreOutput {
  query: string;
  matches: SearchResult[];
  relationships: RelationshipEntry[];
  sourceSnippets: SourceSnippet[];
  freshness: FreshnessBlock;
  truncated: boolean;
  nextQuery?: string;
}

/** Top-level JSON output for `repo-graph affected`. */
export interface AffectedOutput {
  changedFiles: string[];
  affected: AffectedFileEntry[];
  truncated: boolean;
  testsOnly: boolean;
}

/** Top-level JSON output for `repo-graph impact`. */
export interface ImpactOutput {
  root: string;
  /** Combined incoming + outgoing relationships (alias for upstream + downstream). */
  relationships: RelationshipEntry[];
  /** Edges that point AT the root (what depends on the root). */
  upstream: RelationshipEntry[];
  /** Edges that point AWAY FROM the root (what the root depends on). */
  downstream: RelationshipEntry[];
  routes: string[];
  components: string[];
  hooks: string[];
  schemas: string[];
  fields: string[];
  paramFlow: Array<{ source: string; target: string; tainted: boolean }>;
  affectedTests: string[];
  freshness: FreshnessBlock;
  truncated: boolean;
  sourceSnippets?: SourceSnippet[];
  nextQuery?: string;
}

/** Category reported by the documentation audit. */
export type DocumentationIssueCategory =
  | "missing_jsdoc"
  | "missing_description"
  | "missing_param"
  | "mismatched_param"
  | "missing_returns"
  | "duplicate_tag"
  | "extra_tag"
  | "unsupported_form";

/** One documentation contract violation for a persisted public node. */
export interface DocumentationIssue {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  category: DocumentationIssueCategory;
  message: string;
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

// ── Graph metadata contract ─────────────────────────────────────────────────

/**
 * Structured metadata stored in the `meta` table under the key `"graph"`.
 * Tracks schema version for conflict detection and the last commit SHA
 * that updated the graph.
 */
export interface GraphMetadata {
  schemaVersion: string;
  commitSha: string | null;
  lastIndexedAt?: number;
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
