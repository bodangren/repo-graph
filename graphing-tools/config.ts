import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { BuildGraphConfig, CustomEdgeDef, GraphNode, GraphEdge, NodeType } from "./contract";

const CONFIG_FILENAME = "build-graph.config.json";

/**
 * Load build-graph config from a JSON file.
 * Returns null if no config file exists. Throws on malformed JSON.
 */
export function loadConfig(projectDir: string, configPath?: string): BuildGraphConfig | null {
  const resolvedPath = configPath ?? join(projectDir, CONFIG_FILENAME);

  if (!existsSync(resolvedPath)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Malformed config file ${resolvedPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Config file ${resolvedPath} must be a JSON object`);
  }

  const config = parsed as BuildGraphConfig;
  const validated: BuildGraphConfig = {};

  if (Array.isArray(config.customEdges)) {
    const validEdges: CustomEdgeDef[] = [];
    const validNodeTypes = new Set<string>(["file", "function", "class", "interface", "type_alias", "variable", "import", "export", "schema", "field", "route", "param"]);

    for (const entry of config.customEdges) {
      if (!entry.type || typeof entry.type !== "string") {
        console.error(`Warning: skipping custom edge with missing 'type': ${JSON.stringify(entry)}`);
        continue;
      }
      if (!entry.sourceType || !validNodeTypes.has(entry.sourceType)) {
        console.error(`Warning: skipping custom edge '${entry.type}' with invalid sourceType '${entry.sourceType}'`);
        continue;
      }
      if (!entry.targetType || !validNodeTypes.has(entry.targetType)) {
        console.error(`Warning: skipping custom edge '${entry.type}' with invalid targetType '${entry.targetType}'`);
        continue;
      }
      validEdges.push(entry);
    }

    if (validEdges.length > 0) {
      validated.customEdges = validEdges;
    }
  }

  return validated;
}

/**
 * Apply custom edge definitions to the scanned nodes.
 * Scopes edges by file co-occurrence (same-file) or import relationships,
 * not a cartesian product.
 *
 * scope modes:
 *   "same-file" (default) — only connect source/target in the same file
 *   "imported"            — connect if source file imports target file
 *   "all"                 — connect every matching pair (cartesian product)
 */
export function applyCustomEdges(
  nodes: GraphNode[],
  customEdges: CustomEdgeDef[],
  importEdges?: GraphEdge[]
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  // Build a set of (sourceFile → targetFile) import pairs for fast lookup
  const importPairs = new Set<string>();
  if (importEdges) {
    for (const e of importEdges) {
      if (e.type === "imports") {
        const srcFile = e.source.replace(/^file:/, "");
        const tgtFile = e.target.replace(/^file:/, "");
        importPairs.add(`${srcFile}\0${tgtFile}`);
      }
    }
  }

  for (const def of customEdges) {
    const scope = def.scope ?? "same-file";
    const sources = nodes.filter((n) => n.type === def.sourceType);
    const targets = nodes.filter((n) => n.type === def.targetType);

    // Index targets by file path for fast same-file lookup
    const targetsByFile = new Map<string, GraphNode[]>();
    for (const t of targets) {
      const arr = targetsByFile.get(t.filePath) ?? [];
      arr.push(t);
      targetsByFile.set(t.filePath, arr);
    }

    for (const source of sources) {
      let candidates: GraphNode[];

      if (scope === "same-file") {
        candidates = targetsByFile.get(source.filePath) ?? [];
      } else       if (scope === "imported") {
        // Targets in same file + targets in files this source's file imports
        candidates = [...(targetsByFile.get(source.filePath) ?? [])];
        for (const pairKey of importPairs) {
          const [src, tgt] = pairKey.split("\0");
          if (src === source.filePath) {
            candidates.push(...(targetsByFile.get(tgt) ?? []));
          }
        }
      } else {
        // "all" — cartesian product
        candidates = targets;
      }

      for (const target of candidates) {
        if (def.pattern.targetName) {
          const pattern = def.pattern.targetName;
          const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
          if (!regex.test(target.name)) continue;
        }

        edges.push({
          source: source.id,
          target: target.id,
          type: def.type as GraphEdge["type"],
          direction: "forward",
          weight: 1.0,
        });
      }
    }
  }

  return edges;
}
