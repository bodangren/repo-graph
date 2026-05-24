#!/usr/bin/env bash
set -euo pipefail

echo "=== Measure Doctor ==="

# Run architectural linter
echo "→ Running ESLint with boundary checks..."
bun run lint

# Check generated docs freshness
echo "→ Checking generated docs freshness..."
if [ -d "measure/generated" ]; then
  git diff --exit-code measure/generated/ || {
    echo "ERROR: Generated docs are stale. Run 'bun run generate' and commit the results."
    exit 1
  }
else
  echo "WARNING: measure/generated/ does not exist. Run 'bun run generate'."
  exit 1
fi

echo "=== Doctor passed ==="
