#!/usr/bin/env bash
set -euo pipefail

mkdir -p measure/generated

echo "→ Generating architecture.json..."

# Build a simple architecture JSON
bun -e '
import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

function walk(dir, base = "") {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = join(base, name).replace(/\\/g, "/");
    const s = statSync(path);
    if (s.isDirectory()) {
      entries.push({ type: "directory", path: rel, children: walk(path, rel) });
    } else {
      const ext = name.split(".").pop();
      const size = s.size;
      entries.push({ type: "file", path: rel, extension: ext, size });
    }
  }
  return entries;
}

const graphingTools = walk("graphing-tools");
const measureDir = walk("measure");

const architecture = {
  generated_at: new Date().toISOString(),
  project_root: ".",
  measure_zone: "graphing-tools",
  directories: {
    "graphing-tools": graphingTools,
    measure: measureDir,
  },
};

await Bun.write("measure/generated/architecture.json", JSON.stringify(architecture, null, 2));
console.log("Wrote measure/generated/architecture.json");
'

echo "→ Generating routes.md..."

cat > measure/generated/routes.md << 'EOF'
# Project Structure

> Auto-generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

## graphing-tools/

CLI tooling for the knowledge graph SQLite companion.

| File | Purpose |
|------|---------|
| `build-fingerprints.mjs` | Build fingerprint hashes for graph nodes |
| `extract-structure.mjs` | Extract code structure for graph ingestion |
| `merge-batch-graphs.py` | Merge batch graph outputs (to be migrated to Bun) |

## measure/

Project management artifacts (Measure framework).

| File | Purpose |
|------|---------|
| `product.md` | Product definition |
| `product-guidelines.md` | Voice, tone, UX principles |
| `tech-stack.md` | Technology choices |
| `workflow.md` | Development workflow |
| `index.md` | Project context index |
| `tracks.md` | Tracks registry |
| `tracks/` | Individual track directories |
| `code_styleguides/` | Language-specific style guides |
| `generated/` | Machine-generated facts |
| `doctor.sh` | Architectural linting script |
| `generate.sh` | Generator script |
| `lessons-learned.md` | Curated project memory |
| `tech-debt.md` | Known shortcuts registry |

## Root Files

| File | Purpose |
|------|---------|
| `package.json` | Bun package manifest |
| `eslint.config.js` | ESLint flat config with boundary rules |
| `DESIGN.md` | Design definition (CLI-first, no UI) |
EOF

echo "=== Generate complete ==="
