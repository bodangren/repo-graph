# Tech Debt Registry

> This file is curated working memory, not an append-only log. Keep it at or below **50 lines**.
> Remove or summarize resolved items when they no longer need to influence near-term planning.
>
> **Severity:** `Critical` | `High` | `Medium` | `Low`
> **Status:** `Open` | `Resolved`

| Date | Track | Item | Severity | Status | Notes |
|------|-------|------|----------|--------|-------|
| 2026-05-24 | graphdb_20260524 | `build-graph-db.ts` reads JSON input instead of scanning TypeScript source files. Entire track built on wrong product spec. | High | Open | Needs rewrite: ts-morph AST extraction → SQLite. Legacy scripts in `graphing-tools/legacy/` are the reference for what extraction should do. |
| 2026-05-24 | graphdb_20260524 | `ingest.ts` designed for JSON batch insert; needs redesign for ts-morph-driven incremental updates. | High | Open | Blocked on scanner implementation. |
| 2026-05-24 | — | `measure/product.md` and `measure/tech-stack.md` inherited from external project. Rewritten but verify no stale refs remain. | Medium | Resolved | Docs rewritten. Code still references JSON pipeline. |
