# Scanner Enrichment Track

- [Specification](./spec.md)
- [Implementation Plan](./plan.md)
- [Metadata](./metadata.json)

## Results

- **193 tests pass**, 0 fail (382 expect calls)
- **Coverage**: 93.68% functions, 92.62% lines
- **Doctor**: passed
- **Build**: compiled and installed to `~/.local/bin/build-graph`

### Commits

1. `measure(plan): Create scanner enrichment track for runtime schema & framework-aware edges`
2. `feat(scanner): Runtime schema extraction, framework edges, package labeling, and filtered queries`

### What was implemented

- **S1 — Runtime Schema Extraction**: `scanSchemas()` detects `defineTable({})`, `z.object({})`, and exported `const` object literals, emitting `schema`/`field` nodes with `has_field` and `references` edges.
- **S2 — Framework-Aware Edges**: `scanFrameworkEdges()` detects JSX `<Component />`, `useHook()`, `useQuery(api.x.y)`, and `useMutation(api.x.y)`, emitting `renders`, `uses_hook`, `queries`, and `mutates` edges.
- **S3 — Package Labeling**: `scanProject()` now derives `package_id` from the nearest `tsconfig.json` boundary and stores it on every node.
- **S4 — Filtered Queries**: `deps` and `callers` commands support `--from-package` and `--to-package` SQL filters. `stats` uses `package_id` when available.
