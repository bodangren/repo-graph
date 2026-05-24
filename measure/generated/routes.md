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
