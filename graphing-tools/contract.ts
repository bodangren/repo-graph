/**
 * CLI Contract — Type definitions for the build-graph command-line interface.
 *
 * These types are the source of truth for argument shapes, exit codes,
 * and output formats across all subcommands.
 */

// ── Subcommands ────────────────────────────────────────────────────────────

export type Subcommand = "init" | "scan" | "update" | "query" | "search" | "deps" | "callers" | "path" | "stats" | "files" | "help" | "version" | "inspect";

// ── Per-subcommand argument shapes ─────────────────────────────────────────

export interface InitArgs {
  dbPath: string;
}

export interface ScanArgs {
  projectDir: string;
  dbPath: string;
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

export interface SearchArgs {
  dbPath: string;
  keyword: string;
}

export interface DepsArgs {
  dbPath: string;
  name: string;
  downstream: boolean;
  json?: boolean;
  limit?: number;
  depth?: number;
}

export interface CallersArgs {
  dbPath: string;
  name: string;
  json?: boolean;
  limit?: number;
  depth?: number;
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
  | { subcommand: "inspect"; args: InspectArgs };

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
}

export type NodeType =
  | "file"
  | "function"
  | "class"
  | "interface"
  | "type_alias"
  | "variable"
  | "import"
  | "export";

export interface GraphEdge {
  source: NodeId;
  target: NodeId;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  weight?: number;
}

export type EdgeType =
  | "contains"
  | "imports"
  | "extends"
  | "implements"
  | "calls"
  | "depends_on"
  | "exports"
  | "tested_by";

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
