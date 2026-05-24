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
  const kg = JSON.parse(raw);

  const db = new Database(outputPath);
  try {
    createSchema(db);
    createIndexes(db);
    ingestNodes(db, kg.nodes ?? []);
    ingestEdges(db, kg.edges ?? []);
    ingestLayers(db, kg.layers ?? []);
    ingestTourSteps(db, kg.tour_steps ?? []);
    resolveLayerIds(db);
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
