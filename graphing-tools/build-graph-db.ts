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

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  await validateInputFile(args.inputPath);
  throw new Error("Not yet implemented: graph.db builder");
}

if (import.meta.main) {
  main(Bun.argv).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(message.startsWith("Usage:") ? 2 : 1);
  });
}
