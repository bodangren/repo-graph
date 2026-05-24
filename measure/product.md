# Knowledge Graph Query Layer

## Problem

Understand Anything produces an interactive JSON knowledge graph for codebase understanding. However, LLM-powered chat interactions (`/understand-chat`) currently rely on `grep` to search the flat JSON — an inefficient approach that makes multi-hop and cross-node-type queries impractical.

Example limitations:
- Finding "all functions that call the auth hook" requires multiple grep passes
- Tracing a data flow from API → service → DB needs 3+ separate searches
- No indexed lookup — every query scans the full JSON

## Solution

A **SQLite companion database** built alongside the existing JSON graph during analysis. The SQLite file becomes the queryable backend for all LLM chat interactions. The JSON remains the source of truth for the dashboard.

## How it works

1. **Build time**: Phase 7 of `/understand` generates `graph.db` alongside `knowledge-graph.json`
   - Creates normalized tables: `nodes`, `edges`, `layers`, `tour_steps`
   - Builds indexes on `id`, `type`, `name`, `tags`
   - Zero additional services — single file, no daemon

2. **Query time**: `/understand-chat` uses `sqlite3` as a tool
   - LLM writes SQL against documented schema
   - Query patterns (find_nodes, get_dependencies, trace_path) provided as skill instructions
   - No MCP server, no extra infrastructure

## Benefits

- **Indexed random access** — O(log n) lookups vs O(n) JSON scan
- **Multi-hop queries** — SQL joins + CTEs for A→B→C traversal
- **Rich tooling** — Aggregations, grouping, filtering by type/tag/layer
- **Single file** — `graph.db` in `.understand-anything/`, versioned alongside JSON
- **Zero infra** — `sqlite3` CLI is ubiquitous, no server process needed
- **LLM-friendly** — Query patterns documented as skill instructions, LLM writes SQL directly

## What lives where

| Artifact | Purpose |
|----------|---------|
| `.understand-anything/knowledge-graph.json` | Dashboard rendering (React Flow) |
| `.understand-anything/graph.db` | LLM query backend (SQLite) |
| `.understand-anything/meta.json` | Analysis metadata |
| `copy/graphing-tools/` | SQL schema + query pattern docs |

## Interaction with existing pipeline

The SQLite build is additive — it happens in Phase 7, after the graph is assembled and validated. It does not change any upstream phase (scan, analyze, assemble, architecture, tour). The existing JSON pipeline is unaffected.