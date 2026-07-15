# Specification: Foundational Graph Correctness, JSDoc Audit, and TypeScript 7

Track: `graph_correctness_jsdoc_ts7_20260715`

## Overview

`repo-graph` currently passes its runtime test suite while several core product
contracts fail against the compiled CLI and the repository's own source tree.
Full scans are not repeatable, incremental updates are not semantically
equivalent to a clean scan, ordinary function calls are absent from the graph,
impact traversal can invent or invert relationships, freshness metadata is not
fully wired, and integrity audit reports expected external references and
scoped parameters as corruption.

The `summary` field is populated from only the first description on named
function declarations. Exported arrow functions, classes, interfaces, type
aliases, and public class methods do not receive JSDoc details; parameter and
return documentation is discarded; and no CLI contract reports missing or
incomplete public API documentation.

The repository also lacks a committed compiler and type-check script. Both the
TypeScript 6 compatibility compiler and TypeScript 7 expose existing type
errors even though lint, build, doctor, and runtime tests pass. TypeScript 7 is
appropriate as the primary type-checking CLI, but it cannot replace
`ts-morph`'s embedded TypeScript 6 compiler API because TypeScript 7.0 does not
ship a programmatic API.

This track delivers one correctness release. It absorbs the unstarted
`binary_scanner_unification_20260627` track, retains the skill name
`build-graph` for agent discoverability, establishes `repo-graph` as the
canonical executable, and ends with verified copies of both the executable and
skill in their installed locations.

## Verified Baseline (2026-07-15)

- A second compiled full scan of the same project/database fails with
  `UNIQUE constraint failed: nodes.id`.
- Updating an imported file can remove an incoming import edge and relabel its
  nodes from their package boundary to `root`.
- The self-graph contains no ordinary `calls` edges, and `callers createSchema`
  returns no result despite a direct source call.
- `impact` can reverse direction, synthesize relationships, choose one
  arbitrary contained symbol for a file root, and classify unrelated tests as
  affected.
- Full scan does not populate complete `files` metadata, and freshness checks
  do not consistently compare stored metadata to the live filesystem.
- Self-audit reports seven expected external `ts-morph` references as orphaned
  and 44 duplicate groups caused by same-named parameters in different scopes.
- Of 64 production exported function nodes, 36 have an empty `summary`; this is
  a population metric, not a reliable JSDoc-compliance metric, because several
  declaration forms are unsupported.
- `CI=true bun test --coverage` passes 451 tests and reports 91.25% line
  coverage overall, while the CLI entrypoint is only 14.16% covered.
- TypeScript 7.0.2 and the TypeScript 6.0.2 compatibility compiler report the
  same classes of existing source/test errors. Warm local probes were
  materially faster under TypeScript 7, but performance numbers are not an
  acceptance threshold because the host was loaded.
- The tracked worktree was clean before this track was authored.

## Functional Requirements

### FR-1 — TypeScript 7 and a Green Type-Safety Gate

1. Update `measure/tech-stack.md` before package changes to document:
   - TypeScript 7 as the primary CLI/language-server target.
   - TypeScript 6 as the compatibility CLI/API bridge.
   - `ts-morph` 28 and its embedded TypeScript 6.0.2 runtime as the AST engine.
2. Add TypeScript 7.0.2 or a compatible `^7.0.2` release as the native compiler
   and `@typescript/typescript6` as the compatibility compiler, using the
   official side-by-side package layout and verifying Bun's binary links.
3. Add non-interactive scripts for `typecheck`, `typecheck:compat`, and a
   complete pre-commit/CI check.
4. Fix every current TypeScript diagnostic in source and tests without
   weakening `strict`, excluding files, or adding blanket suppressions.
5. TypeScript 7 and TypeScript 6 must produce zero diagnostics before later
   phases can close.

### FR-2 — Canonical Executable, Entrypoint, and Legacy Scanner Unification

1. Establish `repo-graph` as the canonical executable and help-banner name.
2. Rename/refactor the current entrypoint without preserving two divergent
   command implementations.
3. Retire the legacy JSON-ingest scanner path by routing every scan through the
   same `ts-morph` AST pipeline and shared persistence layer.
4. Update package `bin` metadata, build scripts, hooks, README, AGENTS guidance,
   tests, and examples to use the canonical executable.
5. Do not leave two independently compiled binaries or two scanner algorithms.

### FR-3 — Deterministic, Idempotent, Transactional Full Scan

1. Repeated scans of the same source into the same database must succeed.
2. Equivalent source/configuration must produce the same normalized nodes,
   edges, package IDs, documentation, file metadata, and FTS rows.
3. Full rebuild must be atomic: a parse or persistence failure must leave the
   prior valid graph available rather than a partially replaced graph.
4. Node identity must be deterministic and scope-aware for declarations with
   repeated names, overloads, nested declarations, and anonymous declarations.
5. Full scan must populate search indexes and file metadata in the same
   transaction or atomic promotion boundary as graph data.

### FR-4 — Incremental Update Equivalence

1. For any changed-file set, incremental output must equal a clean full scan of
   the resulting source tree after normalizing non-semantic metadata.
2. Updating a file must preserve or reconstruct incoming imports/calls and
   other cross-file edges.
3. Package IDs must continue to come from the owning `tsconfig.json` boundary.
4. Add, modify, rename, move, delete, and documentation-only edits must be
   handled atomically.
5. FTS and file metadata must be inserted, updated, or deleted with their graph
   rows.

### FR-5 — Real Call Edges and Reliable `callers`

1. Use a two-pass symbol/index strategy so nodes exist before cross-file call
   targets are resolved.
2. Extract direct calls to local functions, imported named/default functions,
   and supported class/static methods.
3. Represent unresolved or dynamic calls explicitly; do not silently resolve a
   call to an unrelated same-named symbol.
4. `callers`, `deps`, `path`, `explore`, and `impact` must consume the same edge
   direction and identity contract.
5. A self-scan must report the known direct call to `createSchema` and other
   fixture calls with correct source and target nodes.

### FR-6 — Sound `impact` and `affected` Traversal

1. Traverse only persisted edges; never infer an unrecorded relationship from
   display grouping or node containment.
2. Preserve incoming/outgoing direction in text and JSON output.
3. Use cycle-safe breadth-first traversal with deterministic ordering, depth,
   path, and truncation semantics.
4. A file root expands to the file node and its explicitly contained symbols;
   it must not select one arbitrary child.
5. Affected tests must be graph-connected or match the established
   path-anchored test classifier. Unrelated tests must not be returned.
6. Package filters and `--include-source` must be applied consistently.

### FR-7 — Live Freshness and FTS Correctness

1. Full scan and incremental update must call the shared FTS and file-metadata
   helpers for every inserted, updated, or deleted file/node.
2. Freshness compares stored size, mtime, hash, and/or configured evidence to
   the live filesystem according to one documented contract.
3. Touching, editing, moving, or deleting a file must produce the documented
   stale/missing result until the graph is updated.
4. FTS searches must reflect added, renamed, documented, and deleted symbols
   immediately after successful scan/update.

### FR-8 — Integrity Audit Without Structural False Positives

1. Distinguish expected external/unresolved targets from broken internal graph
   references.
2. Duplicate detection must use scoped identity and must not group parameters
   from different functions merely because names match.
3. Audit must cover every persisted node type or explicitly report a type as
   unsupported; unsupported nodes must not be silently classified as valid.
4. Human and JSON output must contain the same issue set and stable category
   names.
5. Self-audit after a clean self-scan must contain no known false-positive
   `ts-morph` orphan edges or cross-scope duplicate-parameter groups.

### FR-9 — Structured JSDoc Extraction for Supported Public Nodes

1. Populate `summary` with the normalized description for backward-compatible
   search and display.
2. Add a versioned structured documentation payload to nodes containing the
   description, parameter descriptions, return description, and supported tags
   without duplicating TypeScript types.
3. Support exported named functions, exported arrow/function expressions,
   classes, interfaces, type aliases, and public methods on exported classes.
4. Preserve multiline descriptions and tags such as `@deprecated`; ordinary
   comments must not be treated as JSDoc.
5. Handle overloads, async and `Promise<void>` returns, rest/default
   parameters, and destructured-parameter limitations deterministically.
6. Documentation changes must flow through both full scan and incremental
   update and appear in `inspect`, search, and JSON output.

### FR-10 — Missing and Incomplete Documentation Reporting

1. Extend `repo-graph audit <db> --docs` with human and JSON output.
2. Default scope is exported/public API nodes; an explicit option may include
   internal nodes.
3. Report distinct categories for missing JSDoc, missing description, missing
   or mismatched `@param`, missing `@returns` on value-returning functions,
   duplicate/extra tags, and unsupported declaration forms.
4. Do not require `@returns` for constructors, `void`, or `Promise<void>`.
5. Use the established process contract: 0 clean, 1 issues/not found,
   2 ambiguous, 3 misuse, and 4 runtime failure.
6. The command must be suitable for CI and must never modify consumer source.

### FR-11 — Test Architecture and Coverage That Exercise Production Paths

1. Every defect in the Verified Baseline receives a failing regression test
   before implementation.
2. Scanner tests include declaration/JSDoc matrices and realistic multi-file
   TypeScript fixtures.
3. Database integration tests invoke full and incremental persistence and
   compare normalized database snapshots.
4. CLI integration tests execute the compiled binary, including repeated scan,
   update, audit, `audit --docs`, callers, impact, `--help`, JSON, and exit
   codes.
5. Refactor command dispatch out of the executable-only boundary as needed so
   the canonical entrypoint and every modified production module reach at
   least 80% line coverage with meaningful assertions.
6. Tests must validate behavior rather than implementation spies alone. Test
   fixtures cannot silently bypass the compiled/persisted production path.

### FR-12 — Help, Skill, Release Documentation, and Installed Artifacts

1. Root and per-command `--help` must document all commands, arguments,
   defaults, JSON shapes, documentation-audit categories, and exit codes.
2. Store the canonical skill source at
   `.agents/skills/build-graph/SKILL.md`. Keep the skill name `build-graph`,
   update its examples to invoke `repo-graph`, and make its schema, node/edge
   types, limitations, freshness behavior, and JSDoc audit match the release.
3. Reconcile README, AGENTS instructions, Measure tech-stack/schema examples,
   and remaining upcoming-track references with the live schema and canonical
   executable.
4. Build `./bin/repo-graph`, copy it atomically to
   `/home/daniel-bo/.local/bin/repo-graph`, and verify source/installed
   checksums plus smoke commands.
5. Copy the tracked skill atomically to
   `/home/daniel-bo/.agents/skills/build-graph/SKILL.md`, verify checksums, and
   run a fresh agent-facing command sequence from the installed artifacts.
6. Remove the obsolete local `build-graph` executable only after tracked and
   installed docs contain no remaining invocation and the canonical binary has
   passed smoke tests.

## Non-Functional Requirements

- **Correctness before optimization:** performance work may not cache or
  accelerate an incorrect graph.
- **TDD:** each behavior change requires a recorded Red result, focused Green
  result, and full-suite regression result.
- **Type safety:** both TypeScript 7 and TypeScript 6 compatibility checks pass
  with strict mode unchanged and no blanket `@ts-ignore`/`any` escape hatch.
- **Atomicity:** scan and update failures cannot publish partial graph, FTS, or
  file-metadata state.
- **Determinism:** stable ordering and normalized JSON make repeated runs
  byte-comparable where timestamps are excluded.
- **Performance:** corrected operations must have a recorded baseline and no
  material regression on the self-repo and deterministic fixtures. Loaded-host
  timings are reported as non-authoritative.
- **Compatibility:** schema changes include migration/version handling and a
  diagnostic for incompatible existing databases.
- **Documentation:** all exported functions changed or introduced by this
  track have JSDoc that describes parameters and returns without restating
  TypeScript types.
- **No hidden installation:** installed copies occur only in the final release
  phase after source tests, build, generated facts, and doctor pass.

## Acceptance Criteria

- [ ] TypeScript 7 and TypeScript 6 compatibility type-checks both exit 0.
- [ ] `CI=true bun test` exits 0; coverage is at least 80% for every modified
      production module and for canonical CLI dispatch.
- [ ] Lint, build, generated-fact checks, and doctor all exit 0.
- [ ] Two consecutive compiled scans into the same database exit 0 and produce
      equivalent normalized graph, FTS, and file-metadata snapshots.
- [ ] Incremental update snapshots match a clean full scan for add, edit,
      rename/move, delete, and documentation-only cases.
- [ ] Self-scan contains verified ordinary calls, including a correct caller
      relationship for `createSchema`.
- [ ] Impact output preserves direction, contains no fabricated paths, expands
      file roots deterministically, and excludes unrelated tests.
- [ ] Live file changes produce correct stale/missing output and FTS reflects
      every successful mutation.
- [ ] Self-audit has no expected-external orphan false positives or
      cross-scope duplicate-parameter false positives.
- [ ] JSDoc descriptions and structured details populate every supported
      exported declaration form and survive incremental updates.
- [ ] `repo-graph audit <db> --docs` accurately reports missing and incomplete
      public API documentation in text and JSON with CI-safe exit codes.
- [ ] Root/per-command help, README, AGENTS, Measure docs, and the tracked skill
      describe the same command/schema behavior.
- [ ] `./bin/repo-graph` and `/home/daniel-bo/.local/bin/repo-graph` have the
      same checksum and installed smoke tests pass.
- [ ] The tracked and installed `build-graph` skill files have the same
      checksum and its documented smoke sequence passes.
- [ ] `graph.db` and generated architecture facts are refreshed after all
      structural edits, and the final tracked worktree is clean.

## Track Relationships and Ordering

- **Supersedes:** `binary_scanner_unification_20260627`; its binary naming,
  legacy scanner, FTS wiring, and installation requirements are included here.
- **Blocks until complete:** query performance benchmarks, visualization export,
  and CI/CD integration. Those tracks depend on trustworthy scan, call, impact,
  audit, and binary contracts.
- **Does not supersede:** the three blocked product tracks; they remain separate
  deliverables after this foundation is accepted.

## Out of Scope

- Replacing `ts-morph` with TypeScript 7 before a supported programmatic API and
  compatible `ts-morph` release exist.
- Graph visualization export, GitHub Action delivery, or the full 10k-file
  performance/benchmark product track.
- Persistent cross-invocation query caching without measurements proving it is
  useful.
- Generating or editing missing JSDoc in consumer repositories.
- LLM-generated summaries, non-TypeScript parsers, or remote graph services.
- Publishing an npm release or changing remote machines; this track installs
  only the explicitly requested local executable and skill copies.
