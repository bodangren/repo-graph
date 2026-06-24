import { Database } from "bun:sqlite";
import { resolve, isAbsolute, relative } from "path";
import { getProjectRoot } from "./meta";
import { toRelativePath } from "./paths";
import {
  type AffectedOutput,
  type AffectedGroup,
  type AffectedFileEntry,
  ExitCode,
  IMPACT_TRAVERSAL_EDGE_TYPES,
  AFFECTED_GROUP_NAMES,
} from "./contract";

/**
 * Public output of a single `runAffected` invocation. `output` is the
 * human-readable text or serialized JSON string.
 */
export interface AffectedResult {
  output: string;
  exitCode: ExitCodeValue;
}

type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

interface AffectedOptions {
  depth?: number;
  testsOnly?: boolean;
  filter?: string;
  projectRoot?: string;
  json?: boolean;
  /** When true, the `files` argument is treated as newline-delimited
   * stdin content. */
  stdin?: boolean;
  /** Optional pre-read stdin content (testable replacement for
   * reading from `process.stdin`). */
  stdinData?: string;
}

/**
 * Normalize a user-supplied file path against `projectRoot`. Returns
 * the absolute form when the path resolves inside the tree; returns
 * `null` when the path escapes `projectRoot` or cannot be resolved.
 *
 * This is a path-traversal guard: a path like `../../../etc/passwd`
 * must not slip through unchecked.
 */
function normalizeInputPath(raw: string, projectRoot: string): string | null {
  if (!isAbsolute(raw)) {
    raw = resolve(projectRoot, raw);
  }
  const resolved = resolve(raw);
  const rel = relative(projectRoot, resolved);
  // A path that escapes starts with ".." or is exactly ""
  if (rel.startsWith("..") || rel === "") return null;
  return resolved;
}

/**
 * Run the `affected` command over the given changed files. Returns a
 * structured `AffectedResult` containing either text or JSON output.
 */
export function runAffected(
  db: Database,
  files: string[],
  options: AffectedOptions = {}
): AffectedResult {
  const projectRoot = options.projectRoot ?? getProjectRoot(db);
  const depth = options.depth ?? 3;
  const testsOnly = options.testsOnly ?? false;
  const filter = options.filter;

  // Resolve stdin input if requested
  let rawInputFiles = files;
  if (options.stdin) {
    const data = options.stdinData ?? "";
    rawInputFiles = data
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  // Path-traversal guard: normalize every path against projectRoot.
  // Paths that escape the project tree are silently dropped so they
  // never reach the SQL layer or the output payload.
  const skipped: string[] = [];
  const inputFiles: string[] = [];
  if (projectRoot) {
    for (const raw of rawInputFiles) {
      const normalized = normalizeInputPath(raw, projectRoot);
      if (normalized) {
        inputFiles.push(normalized);
      } else {
        skipped.push(raw);
      }
    }
  } else {
    inputFiles.push(...rawInputFiles);
  }
  if (skipped.length > 0 && !options.json) {
    console.error(`Skipped ${skipped.length} path(s) outside project root: ${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? "..." : ""}`);
  }

  const changedFiles = inputFiles.slice().sort();
  const displayChangedFiles = projectRoot
    ? changedFiles.map((p) => toRelativePath(p, projectRoot)).sort()
    : changedFiles.slice().sort();

  const affected = computeAffected(db, changedFiles, {
    depth,
    testsOnly,
    filter,
    projectRoot,
  });

  const output: AffectedOutput = {
    changedFiles: displayChangedFiles,
    affected,
    truncated: false,
    testsOnly,
  };

  if (options.json) {
    return {
      output: JSON.stringify(output),
      exitCode: ExitCode.Success,
    };
  }
  return {
    output: formatAffectedText(output),
    exitCode: ExitCode.Success,
  };
}

/** Format the affected output as human-readable text. */
export function formatAffectedText(result: AffectedOutput): string {
  const lines: string[] = [];
  lines.push("Affected files");
  lines.push("===============");
  lines.push(`Changed (${result.changedFiles.length}):`);
  for (const c of result.changedFiles) lines.push(`  ${c}`);
  lines.push("");

  const byGroup: Record<AffectedGroup, AffectedFileEntry[]> = {
    tests: [],
    routes: [],
    components: [],
    dataAccess: [],
    other: [],
  };
  for (const a of result.affected) byGroup[a.group].push(a);

  for (const groupName of AFFECTED_GROUP_NAMES) {
    const items = byGroup[groupName];
    if (items.length === 0) continue;
    lines.push(`${groupName} (${items.length}):`);
    for (const item of items) {
      lines.push(`  ${item.path}`);
    }
    lines.push("");
  }

  if (result.affected.length === 0) {
    lines.push("(no affected files)");
  }
  return lines.join("\n");
}

// ── Internal helpers ───────────────────────────────────────────────────────

interface ComputeOptions {
  depth: number;
  testsOnly: boolean;
  filter: string | undefined;
  projectRoot: string | undefined;
}

function computeAffected(
  db: Database,
  changedFiles: string[],
  opts: ComputeOptions
): AffectedFileEntry[] {
  if (changedFiles.length === 0) return [];

  // For each changed file, run a reverse traversal over edges where
  // the changed file's nodes are the target. Collect every distinct
  // file that depends on it (directly or transitively).
  const placeholders = IMPACT_TRAVERSAL_EDGE_TYPES.map(() => "?").join(",");
  const seen = new Map<string, AffectedFileEntry>();

  for (const changed of changedFiles) {
    // Resolve the file node id(s) — the change can be a path that
    // matches one or more node rows (e.g. a file node plus its
    // symbol nodes).
    const fileNodeRows = db
      .prepare(
        "SELECT id, file_path, type FROM nodes WHERE file_path = ? OR id = ?"
      )
      .all(changed, `file:${changed}`) as Array<{
      id: string;
      file_path: string;
      type: string;
    }>;
    const seedNodeIds = new Set<string>(fileNodeRows.map((r) => r.id));
    if (seedNodeIds.size === 0) {
      // Even if no exact row matches, surface the changed file path
      // as an unknown / "other" entry so the caller knows we saw it.
      const entry = makeAffectedEntry(db, changed, opts);
      if (entry && (!opts.testsOnly || entry.group === "tests")) {
        seen.set(changed, entry);
      }
      continue;
    }

    // Recursive walk: from each seed, follow incoming edges over
    // IMPACT_TRAVERSAL_EDGE_TYPES up to `depth` hops, collecting
    // every distinct file_path.
    const seedList = Array.from(seedNodeIds);
    const sql = `
      WITH RECURSIVE upstream(id, depth, path) AS (
        SELECT id, 0, id FROM nodes WHERE id IN (${seedList.map(() => "?").join(",")})
        UNION ALL
        SELECT e.source, u.depth + 1, u.path || ' ← ' || e.source
        FROM edges e
        JOIN upstream u ON e.target = u.id
        WHERE u.depth < ?
          AND e.type IN (${placeholders})
      )
      SELECT DISTINCT n.file_path, u.path
      FROM upstream u
      JOIN nodes n ON n.id = u.id
      WHERE n.type = 'file' AND u.depth > 0
    `;
    const rows = db
      .prepare(sql)
      .all(
        ...seedList,
        opts.depth,
        ...IMPACT_TRAVERSAL_EDGE_TYPES
      ) as Array<{ file_path: string; path: string }>;

    for (const row of rows) {
      const entry = makeAffectedEntry(db, row.file_path, opts, row.path);
      if (!entry) continue;
      if (opts.testsOnly && entry.group !== "tests") continue;
      if (opts.filter && !matchesGlob(row.file_path, opts.filter)) continue;
      const existing = seen.get(entry.path);
      if (!existing) {
        seen.set(entry.path, entry);
      } else if (entry.paths.length > 0) {
        for (const p of entry.paths) existing.paths.push(p);
      }
    }
  }

  // Sort for determinism — by group order then by path.
  const groupOrder: Record<AffectedGroup, number> = {
    tests: 0,
    routes: 1,
    components: 2,
    dataAccess: 3,
    other: 4,
  };
  return Array.from(seen.values()).sort((a, b) => {
    const ga = groupOrder[a.group];
    const gb = groupOrder[b.group];
    if (ga !== gb) return ga - gb;
    return a.path.localeCompare(b.path);
  });
}

function makeAffectedEntry(
  _db: Database,
  filePath: string,
  opts: ComputeOptions,
  provenancePath?: string
): AffectedFileEntry | null {
  const projectRoot = opts.projectRoot;
  const displayPath = projectRoot
    ? toRelativePath(filePath, projectRoot)
    : filePath;
  const group = classifyFile(filePath);
  const entry: AffectedFileEntry = {
    path: displayPath,
    group,
    paths: provenancePath ? [provenancePath.split(" ← ")] : [],
  };
  return entry;
}

/**
 * Classify a file into one of the `AffectedGroup` buckets. Test
 * classification uses path-anchored globs (anti-pattern A7) and never
 * matches a bare English word.
 */
export function classifyFile(filePath: string): AffectedGroup {
  if (isTestFile(filePath)) return "tests";
  if (isRouteFile(filePath)) return "routes";
  if (isComponentFile(filePath)) return "components";
  if (isDataAccessFile(filePath)) return "dataAccess";
  return "other";
}

/** Path-anchored test-file classifier (per anti-pattern A7). */
export function isTestFile(filePath: string): boolean {
  return /(?:^|\/)(?:__tests__|e2e|playwright)\//.test(filePath) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(filePath);
}

/** App-router / pages-router route file classifier. */
export function isRouteFile(filePath: string): boolean {
  return /\/app\/.*\/(?:page|layout|route|loading|error|not-found)\.[jt]sx?$/.test(filePath) ||
    /\/pages\/.*\.[jt]sx?$/.test(filePath) ||
    /\/api\/.*\.(?:ts|tsx|js|jsx)$/.test(filePath);
}

/** React component file classifier. */
export function isComponentFile(filePath: string): boolean {
  return /\/components?\//.test(filePath) && /\.[jt]sx?$/.test(filePath);
}

/** Database / data-access classifier. */
export function isDataAccessFile(filePath: string): boolean {
  return /\/db\//.test(filePath) ||
    /\/models?\//.test(filePath) ||
    /\/repositories?\//.test(filePath) ||
    /\/queries\.[jt]sx?$/.test(filePath);
}

/** Minimal glob match (supports `*` and trailing `*`). */
function matchesGlob(path: string, pattern: string): boolean {
  if (!pattern) return true;
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*") +
      "$"
  );
  return re.test(path);
}
