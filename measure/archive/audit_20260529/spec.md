# Specification: Graph Integrity Audit Command

## Overview

Add an `audit` subcommand to `build-graph` that cross-references the SQLite knowledge graph against the actual TypeScript source to detect stale nodes, missing files, orphan edges, duplicate nodes, and unresolved symbols. The goal is to give developers a single command that answers: "Is my graph still an accurate picture of my codebase?"

## Sprint Goal

Add an `audit` subcommand to build-graph that cross-references the SQLite graph against the actual TypeScript source to detect stale nodes, missing files, orphan edges, duplicate nodes, and unresolved symbols.

## Stories

### Story S1: Detect Missing Files
**As a** developer  
**I want** to detect when file nodes reference deleted or moved source files  
**So that** the graph stays synchronized with the filesystem

**Acceptance Criteria:**
- Given a graph database with file nodes, When I run `build-graph audit <db>`, Then it reports any file nodes whose `file_path` no longer exists on disk.
- Given a missing file report, When viewed with `--json`, Then the output contains the node id, type, name, and missing file_path.
- Given a missing file report, When viewed without `--json`, Then the output is a human-readable table with columns for type, name, and file_path.

**Estimate:** S  
**Priority:** Must

### Story S2: Detect Stale Symbols
**As a** developer  
**I want** to detect when function/class/interface/type/schema nodes no longer exist in their source files  
**So that** renamed or deleted symbols don't linger in the graph

**Acceptance Criteria:**
- Given a graph database with symbol nodes, When I run `build-graph audit <db>`, Then it re-parses each source file with ts-morph and reports nodes whose symbols no longer exist at the recorded location.
- Given a stale symbol, When the source file still exists but the symbol is gone, Then the audit flags it as `stale_symbol`.
- Given a stale symbol, When the symbol was renamed, Then the audit still flags the old node as stale (it does not attempt fuzzy matching).
- Given the `--json` flag, When stale symbols are found, Then the output includes the node id, type, name, file_path, and line_start from the graph.

**Estimate:** L  
**Priority:** Must

### Story S3: Detect Orphan Edges
**As a** developer  
**I want** to detect edges whose source or target nodes no longer exist  
**So that** the graph doesn't contain dangling references

**Acceptance Criteria:**
- Given a graph database with edges, When I run `build-graph audit <db>`, Then it reports edges whose `source` or `target` id is not present in the `nodes` table.
- Given an orphan edge, When reported, Then the output includes the edge type, missing source or target id, and the surviving node id if any.
- Given the `--json` flag, When orphan edges are found, Then the output includes the full edge row.

**Estimate:** S  
**Priority:** Must

### Story S4: Detect Duplicate Nodes
**As a** developer  
**I want** to detect duplicate nodes (same name, type, and file_path)  
**So that** I know when the scanner has indexed the same symbol multiple times

**Acceptance Criteria:**
- Given a graph database with nodes, When I run `build-graph audit <db>`, Then it reports groups of nodes that share the same `name`, `type`, and `file_path`.
- Given duplicate nodes, When reported, Then the output includes the shared key and the list of duplicate node ids.
- Given the `--json` flag, When duplicates are found, Then the output is structured as an array of duplicate groups.

**Estimate:** S  
**Priority:** Should

## Non-Functional Requirements

- **Performance:** The audit of a 40-file project must complete in under 5 seconds on modern hardware.
- **Exit Codes:** Return `0` if no issues found, `1` if any issues found (CI-friendly).
- **Output Format:** Support both human-readable tables and `--json` output.
- **Scope:** The audit operates read-only; it never modifies the database.

## Acceptance Criteria (Track-Level)

- `build-graph audit ./graph.db` runs without error and produces a structured report.
- `build-graph audit ./graph.db --json` produces valid JSON.
- All four story-level acceptance criteria are met.
- Unit tests cover each audit check with >80% coverage.
- The command is documented in `build-graph help audit`.

## Out of Scope

- Auto-fixing detected issues (the audit is read-only; fixing is done via `build-graph update` or `build-graph scan`).
- Checking for semantic drift (e.g., a function that still exists but its signature changed).
- Auditing edge correctness beyond existence (e.g., verifying that an `imports` edge still reflects current imports).
