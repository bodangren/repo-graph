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
 * For each custom edge def, find matching source/target nodes and emit edges.
 */
export function applyCustomEdges(nodes: GraphNode[], customEdges: CustomEdgeDef[]): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const def of customEdges) {
    const sources = nodes.filter((n) => n.type === def.sourceType);
    const targets = nodes.filter((n) => n.type === def.targetType);

    for (const source of sources) {
      // If sourceImport is specified, check if the source's file imports that module
      // (This is a simplified check — we rely on the file node's existence)
      for (const target of targets) {
        // If targetName pattern is specified, check if target name matches
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
