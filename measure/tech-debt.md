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
| 2026-06-24 | agent_explore_freshness_impact_20260622 | `scan` and `update` entrypoints do not auto-call `syncNodeFts` / `recordFileMetadata` for bulk ingest. The schema-level helpers exist and are unit-tested, but the scan-time FTS sync and per-file metadata capture are deferred to a follow-up track. Until wired, FTS results can lag a full scan until the caller invokes `syncNodeFts` on each node; freshness warnings will not flag stale files unless the caller records metadata. | Medium | Open | Track phase 3 §A1 / §A2 deferred wiring. Exposed via `syncNodeFts(node)`, `recordFileMetadata(path, stat, nodeCount)`. Follow-up track should call them from `handleScan` after each `nodes` insert and from `updateFiles` after each replacement. |
| 2026-06-25 | git_hook_incremental_updates_20260528 | Binary-naming gap: `package.json` `name` is `repo-graph` but `bun run build` produces `./bin/build-graph` (compile target name in the build script). The hook scripts installed by `install-hooks` invoke `repo-graph` per spec. Workaround: install the same binary under both `~/.local/bin/build-graph` and `~/.local/bin/repo-graph`. The compiled binary's help banner still says "build-graph — Knowledge graph builder…" — a cosmetic mismatch a future track can fix by renaming `graphing-tools/build-graph.ts` to `repo-graph.ts` and updating the build script. Not blocking acceptance. | Low | Open | Phase 4 closeout install: `cp -f ./bin/build-graph ~/.local/bin/build-graph && cp -f ./bin/build-graph ~/.local/bin/repo-graph`. See `metadata.json` `deviation_notes` for full context. |
