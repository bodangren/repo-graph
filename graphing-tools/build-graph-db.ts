export interface CliArgs {
  inputPath: string;
  outputPath: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  if (args.length < 2) {
    throw new Error("Usage: bun run build-graph-db.ts <input.json> <output.db>");
  }
  return { inputPath: args[0], outputPath: args[1] };
}

export async function validateInputFile(path: string): Promise<void> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Input file not found: ${path}`);
  }
}

import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import { createIndexes } from "./indexes";
import { ingestNodes, ingestEdges, ingestLayers, ingestTourSteps, resolveLayerIds } from "./ingest";

export async function buildGraphDb(inputPath: string, outputPath: string): Promise<void> {
  const raw = await Bun.file(inputPath).text();

  let kg: unknown;
  try {
    kg = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in input file: ${inputPath}\nNext step: verify the file is valid JSON.`);
  }

  if (!kg || typeof kg !== "object") {
    throw new Error(`Invalid input: ${inputPath} does not contain a JSON object.`);
  }

  const graph = kg as Record<string, unknown>;
  const requiredFields = ["nodes", "edges", "layers", "tour_steps"];
  for (const field of requiredFields) {
    if (!(field in graph)) {
      throw new Error(`Missing required field: ${field} in ${inputPath}\nNext step: ensure the knowledge graph JSON has all required top-level keys.`);
    }
    if (!Array.isArray(graph[field])) {
      throw new Error(`Invalid type for field: ${field} in ${inputPath} (expected array)\nNext step: verify the knowledge graph structure.`);
    }
  }

  const db = new Database(outputPath);
  try {
    createSchema(db);
    createIndexes(db);
    ingestNodes(db, graph.nodes as Parameters<typeof ingestNodes>[1]);
    ingestEdges(db, graph.edges as Parameters<typeof ingestEdges>[1]);
    ingestLayers(db, graph.layers as Parameters<typeof ingestLayers>[1]);
    ingestTourSteps(db, graph.tour_steps as Parameters<typeof ingestTourSteps>[1]);
    resolveLayerIds(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`SQLite error while building graph.db: ${message}\nNext step: check disk space and file permissions for ${outputPath}.`);
  } finally {
    db.close();
  }
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  await validateInputFile(args.inputPath);
  await buildGraphDb(args.inputPath, args.outputPath);
}

if (import.meta.main) {
  main(Bun.argv).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(message.startsWith("Usage:") ? 2 : 1);
  });
}
