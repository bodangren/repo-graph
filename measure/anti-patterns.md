# Measure Anti-Patterns Catalog (repo-graph)

> Project-local catalog of orchestrator anti-patterns. Seeded from the canonical
> catalog at `~/.agents/skills/measure-orchestrator/references/anti-pattern-catalog.md`.
> Extend with project-specific entries (continue from A10) when new classes of
> failure are caught. The `measure-orchestrator-audit` subagent picks up new
> entries here in its next run and may promote them to the canonical catalog.

---

## A1 — Substring-as-structured-signal in supervisor

**Class:** orchestrator heuristic bypass
**Caught:** 2026-06-24 review
**Detection:** strip docstrings from `measure/automation-supervisor.py` and search
for `"deferred" in task.lower()` patterns.
**Symptoms:** A `[~]` task with the substring "deferred" is silently dropped from
the incomplete count; tracks can mark work in-progress without doing it.
**Fix:** Use the structured helper `is_task_structurally_blocked(task)` that
recognizes `[b]` checkbox state and trailing `deferred:<owner>` field.
**Guard:** `measure/automation-supervisor.py` regex must be `r"^- \[([~xb])\] (.+)"`.

## A2 — Consent-blind publish gate

**Class:** orchestrator missing requirement
**Caught:** 2026-06-24 review
**Symptoms:** A test flips draft → published without checking consent or
anonymization markers. Named case studies can publish without consent verification.
**Fix:** Require explicit anonymization OR a non-empty `consent-<subject>.{md,pdf}`
artifact for any publish gate.
**Guard:** Static check by `measure-orchestrator-audit`.

## A3 — Digit-only as a "labeled count"

**Class:** test fragility / vacuous assertion
**Symptoms:** A test asserts a "count" using a regex that matches any digit
(e.g. `rg -q '[0-9]+'`), passing on dates/years/incidental digits.
**Fix:** Require labeled integers (`Baseline relationship count:[[:space:]]*[0-9]+`)
and parse them.
**Guard:** `measure-orchestrator-audit`.

## A4 — Vacuous-pass on nothing-done

**Class:** test fragility / vacuous assertion
**Symptoms:** A "markers consistent" check passes when a phase has 0 completed
tasks (all `[~]`) and when 0 in-progress tasks (all `[x]`); an all-`[~]` phase
inflates to PASS.
**Fix:** Reclassify all-`[~]` as INCOMPLETE; reserve PASS for "all `[x]`"
with `>= 1` `[x]`.
**Guard:** `measure-orchestrator-audit`.

## A5 — False-claim text vs test reality

**Class:** plan truthfulness
**Symptoms:** Plan text claims "all checks pass" or "PASS=N, FAIL=0" while the
cited test exits non-zero.
**Fix:** When a test invariant contradicts a spec, retire or rewrite the test;
do not write "all checks pass" unless the test exits 0.
**Guard:** `measure-orchestrator-audit`.

## A6 — Registry-note overstatement

**Class:** marketing copy outrunning implementation
**Symptoms:** A `measure/tracks.md` note claims a security/quality state is
"resolved" while the adversarial test for that state is red.
**Fix:** "Resolved" is only valid when the adversarial test passes.
**Guard:** `measure-orchestrator-audit`.

## A7 — Over-broad filter swallowing real hits

**Class:** test filter too coarse
**Symptoms:** A test's exclusion filter uses bare English words ("never",
"do not", "don't") as filter tokens, silently dropping real banned-term lines.
**Fix:** Exclude only file-path contexts and policy-disclaimer markers, not bare
English words.
**Guard:** `measure-orchestrator-audit`.

## A8 — `[ ]` (space) marker ambiguity (legacy)

**Class:** supervisor regex accepts too many markers
**Symptoms:** The supervisor regex `r"^- \[([ ~x])\] (.+)"` accepts a space
character; `[ ]` is counted as in-progress.
**Fix:** Standardize on `r"^- \[([~xb])\] (.+)"`; incomplete predicate is
`status in ("~", "b") and not is_task_structurally_blocked(task)`.
**Guard:** Static check in `measure-orchestrator-audit`.

## A9 — Pre-existing test references archived track paths

**Class:** test not updated on archive move
**Symptoms:** A test references `measure/tracks/<id>/plan.md` but the track was
moved to `measure/archive/<id>/plan.md` on closeout; the test fails forever.
**Fix:** Use a `track_dir_resolve()` helper that prefers `measure/archive/<id>`.
**Guard:** Static check in `measure-orchestrator-audit`.

## A10 — Generated-facts drift after structural change

**Class:** CI gate that fights developers
**Symptoms:** `measure/doctor.sh` Check 5 fails after every structural change
because no pre-commit hook regenerates `measure/generated/`.
**Fix:** Add a pre-commit hook that runs `bash measure/generate.sh`.
**Guard:** Static check in `measure-orchestrator-audit`.

---

## Project-Specific Notes

- This project uses **Bun's built-in test runner** (`bun test`), not bash
  contract tests. Apply A3/A4 vacuous-assertion guards to `*.test.ts` files.
- Anti-patterns that target bash-only test fixtures (e.g. `tests/mir_p1.sh`) do
  not directly map to this project; their *spirit* still applies to
  `graphing-tools/**/*.test.ts` and to the JSON contract in
  `graphing-tools/contract.ts`.