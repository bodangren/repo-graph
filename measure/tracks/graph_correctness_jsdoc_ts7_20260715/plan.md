# Implementation Plan: Foundational Graph Correctness, JSDoc Audit, and TypeScript 7

Track: `graph_correctness_jsdoc_ts7_20260715`

Follow `measure/workflow.md` for every top-level task: mark in progress, record
Red, implement Green, verify focused and full suites, commit atomically, attach
the Git note, then record the SHA. Do not modify
`measure/automation-supervisor.py`.

## Phase 1: Contract & Schema Definition

_Blast radius: `scanProject` (0 recorded call edges; imported by `build-graph.ts`, `integration.test.ts`, `monorepo.test.ts`, `scanner.test.ts`, `update.ts`), `updateFiles` (0 recorded call edges; imported by `build-graph.ts`, `update.test.ts`), `runImpact` (0 recorded call edges; imported by `build-graph.ts`), `runAudit` (0 recorded call edges; imported by `audit.test.ts`, `build-graph.ts`). Zero caller counts are a verified graph defect and must not be interpreted as zero source usage._

- [~] Task: Record the implementation baseline and supersession boundary
    - [ ] Save exact Red reproduction commands and normalized outputs for repeated scan, incremental/full mismatch, missing calls, impact direction, freshness, audit false positives, documentation population, compiler diagnostics, coverage, help, and installed artifacts.
    - [ ] Confirm `binary_scanner_unification_20260627` has zero completed tasks and is superseded rather than partially merged.
    - [ ] Record the current graph schema version, source/installed executable checksums, installed skill checksum, test count, and coverage by file.
    - [ ] Confirm the worktree is clean before implementation begins.

- [ ] Task: Document the TypeScript 7 and compiler-API architecture before package changes
    - [ ] Update `measure/tech-stack.md` to name TypeScript 7 as primary CLI/language service, TypeScript 6 as compatibility CLI, and `ts-morph`'s embedded TypeScript 6 API as the scanner engine.
    - [ ] Document the official side-by-side package aliases and Bun binary-resolution verification.
    - [ ] Define `typecheck`, `typecheck:compat`, and aggregate `check` commands and quality-gate ordering.
    - [ ] State that replacing the AST engine is deferred until TypeScript exposes a supported API and `ts-morph` adopts it.

- [ ] Task: Define graph identity, documentation, and migration contracts
    - [ ] Add strict types for deterministic scoped node identity and explicitly classified unresolved/external targets.
    - [ ] Add a versioned structured documentation contract with description, parameter descriptions, return description, tags, and validation status.
    - [ ] Preserve `summary` as the normalized description for backward compatibility.
    - [ ] Define schema-version migration/rebuild behavior for the documentation payload and any identity/metadata changes.
    - [ ] Add or update schema/index contract tests before implementation details.

- [ ] Task: Define full-scan and incremental-equivalence contracts
    - [ ] Specify atomic full-scan promotion and failure rollback.
    - [ ] Specify normalized snapshot equality across nodes, edges, package IDs, documentation, files metadata, and FTS.
    - [ ] Specify changed-file plus dependent-file reconciliation for incoming cross-file edges.
    - [ ] Specify add/edit/documentation-only/move/delete behavior and `tsconfig` package ownership.

- [ ] Task: Define call, traversal, freshness, and integrity-audit contracts
    - [ ] Define resolvable local/imported/method call targets and explicit unresolved-call metadata.
    - [ ] Define direction-preserving, cycle-safe BFS output with deterministic ordering, depth, path, and truncation.
    - [ ] Define file-root expansion and graph-connected affected-test rules.
    - [ ] Define live freshness evidence and FTS synchronization semantics.
    - [ ] Define expected-external and scope-aware duplicate-audit categories.

- [ ] Task: Define documentation-audit, CLI, help, and deployment contracts
    - [ ] Extend `AuditArgs`, `AuditResult`, JSON schemas, and text categories for `--docs` and internal-node inclusion.
    - [ ] Define missing description, parameter mismatch, return, duplicate/extra tag, and unsupported-form rules.
    - [ ] Preserve the 0–4 exit-code taxonomy and define every new misuse/runtime case.
    - [ ] Define canonical `repo-graph` root/per-command help and package `bin` behavior.
    - [ ] Define `.agents/skills/build-graph/SKILL.md` as tracked source and the executable/skill checksum installation contract.

- [ ] Task: Measure - User Manual Verification 'Phase 1: Contract & Schema Definition' (Protocol in workflow.md)

## Phase 2: Test

_Blast radius: the Red suite exercises `scanProject`, `updateFiles`, `runImpact`, `runAudit`, CLI parsing/dispatch, schema/meta/files/index helpers, and compiled `repo-graph`; source caller counts remain untrusted until FR-5 is Green._

- [ ] Task: Add Red compiler and CLI contract tests
    - [ ] Add compile-time exhaustiveness tests for discriminated CLI arguments and command dispatch.
    - [ ] Pin the `ExitCodeValue` type so functions do not use value objects as namespaces.
    - [ ] Add tests for current `ExitCode`, `GraphEdge`, `ImpactOutput`, and Bun matcher typing failures.
    - [ ] Run both compiler commands and record the expected non-zero Red diagnostics before fixes.

- [ ] Task: Add Red full-scan idempotency and atomicity integration tests
    - [ ] Execute the compiled binary twice against the same temporary project/database and assert both exits are 0.
    - [ ] Compare normalized graph, files, metadata, indexes, and FTS snapshots after both scans.
    - [ ] Inject parse/persistence failure and assert the previous valid database remains readable and unchanged.
    - [ ] Add deterministic-ID fixtures for repeated names, scopes, overloads, and anonymous declarations.

- [ ] Task: Add Red incremental/full equivalence tests
    - [ ] Cover source edits, documentation-only edits, additions, moves/renames, deletions, and multi-package `tsconfig` ownership.
    - [ ] Assert incoming imports/calls survive or are reconstructed.
    - [ ] Compare normalized incremental database state to a separate clean full scan.
    - [ ] Assert transaction rollback on an injected incremental failure.

- [ ] Task: Add Red ordinary-call and callers-resolution tests
    - [ ] Cover local calls, imported named/default calls, aliases, static/method calls, same-named symbols, and explicit unresolved/dynamic calls.
    - [ ] Assert direction and target identity in persisted `calls` edges.
    - [ ] Assert `callers`, `deps`, `path`, `explore`, and `impact` agree on the same fixture.
    - [ ] Add a self-hosting assertion that `createSchema` has the known source caller.

- [ ] Task: Add Red impact and affected traversal tests
    - [ ] Cover upstream/downstream direction, cycles, diamonds, depth zero/boundaries, truncation, stable order, and package filters.
    - [ ] Assert traversal never emits a relationship absent from the fixture database.
    - [ ] Assert a file root includes the file and all explicitly contained roots rather than one arbitrary child.
    - [ ] Assert only graph-connected/path-classified tests are affected and unrelated tests are excluded.
    - [ ] Assert text and JSON encode the same relationship set.

- [ ] Task: Add Red freshness, FTS, and integrity-audit tests
    - [ ] Cover touch, content edit, rename/move, delete, then update-to-fresh transitions.
    - [ ] Assert full scan and update both synchronize additions, renames, documentation text, and deletions in FTS.
    - [ ] Assert expected external package references are not orphan corruption.
    - [ ] Assert same-named parameters in different functions are not duplicates while true scoped duplicate IDs are reported.
    - [ ] Assert every node type is checked or returned as explicitly unsupported.

- [ ] Task: Add Red JSDoc extraction matrix tests
    - [ ] Cover exported named functions, arrow/function expressions, classes, interfaces, type aliases, public methods, overloads, and unsupported forms.
    - [ ] Cover multiline descriptions, `@param`, `@returns`, `@deprecated`, rest/default/destructured parameters, async value returns, `void`, and `Promise<void>`.
    - [ ] Assert regular comments and whitespace-only descriptions do not count.
    - [ ] Assert `summary` and structured documentation persist through full scan and incremental documentation-only edits.

- [ ] Task: Add Red documentation-audit CLI tests
    - [ ] Cover exported/public default scope and explicit internal-node inclusion.
    - [ ] Cover every missing/incomplete/mismatched/duplicate/unsupported category.
    - [ ] Assert constructors, `void`, and `Promise<void>` do not require return documentation.
    - [ ] Assert stable text/JSON parity and process exit codes through the compiled executable.
    - [ ] Assert the command only reports and never edits the scanned project.

- [ ] Task: Add Red help, skill, build, and installation contract tests
    - [ ] Snapshot root and per-command help for canonical name, syntax, options, JSON, audit categories, and exit codes.
    - [ ] Assert package `bin`, build output, hook templates, README, AGENTS, and tracked skill invoke `repo-graph` consistently.
    - [ ] Add a release verification script/test that compares source and installed checksums without installing during the Red phase.
    - [ ] Assert the tracked skill contains executable smoke commands and current schema/node/edge documentation.

- [ ] Task: Establish meaningful coverage and performance regression baselines
    - [ ] Record per-file lines/functions/branches for every production module and identify behavior missing behind the current 14.16% entrypoint coverage.
    - [ ] Add deterministic correctness benchmarks for self-scan, incremental update, callers, impact, audit, and docs audit.
    - [ ] Keep loaded-host timing results informational; use relative regression thresholds only on controlled fixtures.
    - [ ] Prove new tests fail for behavior, not only missing imports or intentionally broken fixtures.

- [ ] Task: Measure - User Manual Verification 'Phase 2: Test' (Protocol in workflow.md)

## Phase 3: Implement

_Blast radius: `scanProject` (five importing files), `updateFiles` (two importing files), `runImpact` (one importing production file), `runAudit` (one production and one test importer), plus every command consumer of `calls`, freshness, FTS, `summary`, and CLI contracts._

- [ ] Task: Install the side-by-side TypeScript toolchain and clear type debt
    - [ ] Add TypeScript 7 and `@typescript/typescript6` aliases with lockfile updates verified under Bun.
    - [ ] Add `typecheck`, `typecheck:compat`, and aggregate check scripts.
    - [ ] Fix all source and test diagnostics through sound narrowing, imports, contracts, and matcher values.
    - [ ] Keep strict mode and all source/test inclusion intact; prohibit blanket suppressions.
    - [ ] Run both compilers to Green before proceeding.

- [ ] Task: Unify the canonical entrypoint and AST scanner path
    - [ ] Rename/refactor `graphing-tools/build-graph.ts` to the canonical `repo-graph` entrypoint and extract testable dispatch where needed.
    - [ ] Replace/remove the legacy JSON scanner/ingest command path in favor of shared AST extraction and persistence.
    - [ ] Update package `bin`, build, hooks, internal imports, and fixture entrypoints without yet copying installed artifacts.
    - [ ] Keep one compiled source of truth and run focused build/CLI tests Green.

- [ ] Task: Implement atomic deterministic full scan
    - [ ] Build scoped symbol identities and the first-pass node/import index deterministically.
    - [ ] Write graph, documentation, FTS, files, and metadata to a transactionally replaceable database/state.
    - [ ] Promote only after parse, schema, index, and persistence validation succeeds.
    - [ ] Make repeated scan idempotent and preserve the previous graph on failure.
    - [ ] Run full-scan Red tests Green and capture normalized snapshot evidence.

- [ ] Task: Implement incremental/full semantic equivalence
    - [ ] Reuse project/package mapping from `createProject` rather than constructing an unscoped one-file project.
    - [ ] Compute the changed and dependent reconciliation set needed for incoming imports/calls and other cross-file edges.
    - [ ] Apply node, edge, documentation, FTS, files, and deletion changes in one transaction.
    - [ ] Handle moves/renames and rollback failures.
    - [ ] Run incremental equivalence Red tests Green.

- [ ] Task: Implement ordinary call extraction and target resolution
    - [ ] Complete the two-pass scanner with local/imported/method symbol resolution.
    - [ ] Emit explicit unresolved/dynamic call metadata without false same-name binding.
    - [ ] Use the canonical call-edge contract in callers/deps/path/explore/impact.
    - [ ] Re-scan the self-repo and verify `createSchema` plus fixture callers.
    - [ ] Run call/caller Red tests Green.

- [ ] Task: Replace impact and affected traversal with sound deterministic algorithms
    - [ ] Implement direction-preserving, cycle-safe BFS from all resolved roots.
    - [ ] Remove fabricated relationship construction and arbitrary file-child selection.
    - [ ] Apply depth, truncation, package, source, and affected-test filters consistently.
    - [ ] Generate text and JSON from one canonical result structure.
    - [ ] Run traversal Red tests Green.

- [ ] Task: Wire live freshness, FTS, and scope-aware integrity audit
    - [ ] Call shared file metadata and FTS helpers from every full/incremental mutation path.
    - [ ] Compare stored freshness evidence to live filesystem state and format one canonical freshness block.
    - [ ] Classify external/unresolved edges separately from broken internal edges.
    - [ ] Make duplicate and stale-node checks scope- and node-type-aware.
    - [ ] Run freshness/FTS/audit Red tests Green and self-audit the rebuilt graph.

- [ ] Task: Implement normalized structured JSDoc extraction
    - [ ] Add one AST-based extractor shared by all supported declaration forms.
    - [ ] Populate backward-compatible `summary` and versioned structured documentation.
    - [ ] Add public class method nodes/relationships using deterministic qualified identity.
    - [ ] Normalize descriptions/tags without duplicating TypeScript types and encode unsupported cases explicitly.
    - [ ] Wire documentation through full scan, update, persistence, search, inspect, and JSON.
    - [ ] Run the JSDoc Red matrix Green.

- [ ] Task: Implement documentation audit and complete CLI help
    - [ ] Add `audit --docs` parsing, filtering, validation, text/JSON formatting, and exit behavior.
    - [ ] Validate descriptions, parameter names/descriptions, returns, duplicate/extra tags, and unsupported forms against declaration contracts.
    - [ ] Keep consumer source read-only.
    - [ ] Update root and per-command help from one source of truth where practical.
    - [ ] Run compiled documentation-audit/help Red tests Green.

- [ ] Task: Refactor test architecture and reach meaningful coverage
    - [ ] Share temporary-project, database-snapshot, compiled-CLI, and installed-artifact harnesses without hiding production paths.
    - [ ] Remove or rewrite tests whose mocks permit behavior the compiled CLI cannot perform.
    - [ ] Raise every modified production module and canonical dispatch to at least 80% line coverage with success, boundary, and failure assertions.
    - [ ] Run focused suites, full suite, and deterministic correctness benchmarks.

- [ ] Task: Measure - User Manual Verification 'Phase 3: Implement' (Protocol in workflow.md)

## Phase 4: Generate Docs & Doctor

_Blast radius: all agent and human consumers of CLI help, README/AGENTS instructions, Measure schema references, the tracked `build-graph` skill, `/home/daniel-bo/.local/bin/repo-graph`, and `/home/daniel-bo/.agents/skills/build-graph/SKILL.md`._

- [ ] Task: Reconcile all tracked documentation and planning truth
    - [ ] Update README, AGENTS, command examples, exit-code tables, schema references, JSDoc guidance, and migration notes.
    - [ ] Create/update `.agents/skills/build-graph/SKILL.md` with canonical `repo-graph` invocations, current schema, behaviors, limitations, and `audit --docs` workflow.
    - [ ] Update remaining upcoming-track references that use stale schema columns, test counts, binary names, or incorrect dependency ordering.
    - [ ] Mark overlapping tech-debt rows Resolved only with implementation SHA evidence and keep unrelated debt open.

- [ ] Task: Run the complete automated quality gate
    - [ ] Run `bun run typecheck` and require exit 0.
    - [ ] Run `bun run typecheck:compat` and require exit 0.
    - [ ] Run `CI=true bun test --coverage` and enforce the specified module/dispatch coverage gates.
    - [ ] Run `bun run lint` and `bun run build` and require exit 0.
    - [ ] Record exact commands, versions, counts, coverage, and artifact paths in verification evidence.

- [ ] Task: Run compiled self-hosting acceptance
    - [ ] Scan the repo twice into a temporary database and compare normalized snapshots.
    - [ ] Apply representative source and documentation-only incremental edits in a temporary copy and compare against clean scans.
    - [ ] Verify callers, impact direction, affected tests, freshness, FTS, integrity audit, documentation audit, text/JSON parity, and exit codes.
    - [ ] Restore/delete temporary fixtures without touching the user's working source.

- [ ] Task: Generate facts and pass architecture doctor
    - [ ] Run `./measure/generate.sh` after structural/documentation changes.
    - [ ] Run `./measure/doctor.sh` and resolve every violation except the centrally managed supervisor file, which must not be modified.
    - [ ] Run `git diff --exit-code measure/generated/` after staging intended generated changes.
    - [ ] Verify the registry, track metadata, plan status, lessons, and tech debt are internally consistent.

- [ ] Task: Build and copy the canonical executable
    - [ ] Build `./bin/repo-graph` from the reviewed source commit and run source-artifact smoke tests.
    - [ ] Copy via a temporary file and atomic rename to `/home/daniel-bo/.local/bin/repo-graph`, preserving executable permissions.
    - [ ] Compare cryptographic checksums and versions between source and installed executables.
    - [ ] Run installed `--version`, root/per-command `--help`, scan, update, callers, impact, audit, and `audit --docs` smoke commands.
    - [ ] Remove `/home/daniel-bo/.local/bin/build-graph` only after tracked/installed references are migrated and rollback evidence is recorded.

- [ ] Task: Copy and verify the updated associated skill
    - [ ] Validate the tracked `.agents/skills/build-graph/SKILL.md` completely against installed executable behavior.
    - [ ] Copy via a temporary file and atomic rename to `/home/daniel-bo/.agents/skills/build-graph/SKILL.md`.
    - [ ] Compare cryptographic checksums between tracked and installed skill files.
    - [ ] Execute the skill's documented first-contact, query-before-grep, freshness, documentation-audit, update, and troubleshooting sequence using the installed binary.
    - [ ] Record that a skill reload may be required for already-running agent sessions.

- [ ] Task: Refresh the project graph and close the release
    - [ ] Run the installed `repo-graph scan . ./graph.db` because many structural files changed.
    - [ ] Verify stats, callers, integrity audit, documentation audit, files metadata, and FTS against the final source tree.
    - [ ] Update track metadata actual task count/deviations and the tracks registry with implementation/checkpoint evidence.
    - [ ] Confirm generated facts are committed and the final tracked worktree is clean.

- [ ] Task: Measure - User Manual Verification 'Phase 4: Generate Docs & Doctor' (Protocol in workflow.md)
