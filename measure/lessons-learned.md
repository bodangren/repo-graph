# Lessons Learned

> This file is curated working memory, not an append-only log. Keep it at or below **50 lines**.
> Remove or condense entries that are no longer relevant to near-term planning.

## Architecture & Design

- (2026-05-24, graphdb_20260524) **Do not inherit product specs from external projects.** `product.md` and `tech-stack.md` were copied from the "Understand Anything" plugin spec, describing a JSON-to-SQLite companion tool. This repo is standalone. The resulting `build-graph-db.ts` read JSON input — completely wrong for a tool that should scan TypeScript directly. Always verify product context is intrinsic to the repo, not inherited from adjacent projects.

## Recurring Gotchas

## Patterns That Worked Well

## Planning Improvements
