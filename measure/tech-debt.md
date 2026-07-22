# Tech Debt Registry

> This file is curated working memory, not an append-only log. Keep it at or below **50 lines**.
> Remove or summarize resolved items when they no longer need to influence near-term planning.
>
> **Severity:** `Critical` | `High` | `Medium` | `Low`
> **Status:** `Open` | `Resolved`

| Date | Track | Item | Severity | Status | Notes |
|------|-------|------|----------|--------|-------|
| 2026-05-24 | graphdb_20260524 | JSON-ingest entrypoint and batch-only persistence path were product-spec drift. | High | Resolved | Retired; canonical `repo-graph` uses the AST scanner and shared atomic persistence layer. |
| 2026-05-24 | — | `measure/product.md` and `measure/tech-stack.md` inherited from external project. Rewritten but verify no stale refs remain. | Medium | Resolved | Docs rewritten. Code still references JSON pipeline. |
| 2026-06-24 | agent_explore_freshness_impact_20260622 | Scan-time FTS and freshness metadata were deferred. | Medium | Resolved | Full and update persistence now refresh FTS, file hashes, size, mtime, and indexed timestamps atomically. |
| 2026-06-25 | git_hook_incremental_updates_20260528 | Binary naming and help banner diverged from package name. | Low | Resolved | `bun run build` now produces the canonical `./bin/repo-graph`; hooks and docs use the same name. |
| 2026-07-22 | scanner_memory_scalability_20260722 | ESLint exits green but the current configuration does not substantively select TypeScript sources. | Medium | Open | Preserve the gate result as configured, but do not treat it as meaningful TS lint coverage until a dedicated lint-config track repairs selection. |
| 2026-07-22 | scanner_memory_scalability_20260722 | Standalone audit cannot reconstruct stale field/route nodes. | Low | Open | Audit reports these nodes explicitly as `unauditedSymbols`; large-consumer acceptance requires a current full scan and zero structural findings. |
