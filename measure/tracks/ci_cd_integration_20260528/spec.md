# Spec: CI/CD Integration — GitHub Action

## Overview

`repo-graph` is designed to help developers understand their codebase. The most valuable time to surface dependency information is during code review. This track creates a GitHub Action that runs `repo-graph scan` on every pull request, compares the resulting graph against the base branch, and posts a structured dependency impact report as a PR comment.

---

## Functional Requirements

### C1 — GitHub Action Definition

Create a reusable GitHub Action in `.github/actions/repo-graph-action/` (or a standalone repo if preferred).

**Action inputs:**

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `db-path` | No | `graph.db` | Path to the SQLite database artifact |
| `tsconfig-path` | No | `tsconfig.json` | Path to the TypeScript project config |
| `comment-on-pr` | No | `true` | Whether to post a comment on the PR |
| `fail-on-impact` | No | `false` | Fail the workflow if critical nodes are affected |

**Action outputs:**

| Output | Description |
|--------|-------------|
| `nodes-changed` | Number of nodes added/removed/modified |
| `edges-changed` | Number of edges added/removed |
| `impact-report` | Markdown summary of the impact |

### C2 — Dependency Impact Report

The report compares the PR graph against the base branch graph and summarizes:

- **New nodes**: functions, classes, interfaces added.
- **Deleted nodes**: functions, classes, interfaces removed.
- **Modified nodes**: same ID but different edges or properties.
- **New edges**: new call, import, extends relationships.
- **Deleted edges**: removed relationships.
- **Affected entry points**: top-level exports that transitively depend on changed nodes.

**Report format (Markdown):**
```markdown
## 📊 repo-graph Impact Report

| Metric | Count |
|--------|-------|
| Nodes added | 3 |
| Nodes removed | 1 |
| Edges added | 5 |
| Edges removed | 2 |

### 🔥 Affected Entry Points
- `src/api/router.ts` → `src/handlers/user.ts`
- `src/cli.ts:main`

<details>
<summary>Full diff</summary>
...
</details>
```

### C3 — Workflow Template

Provide a reusable workflow template `.github/workflows/repo-graph.yml` that consumers can copy.

**Workflow triggers:**
- `pull_request` (opened, synchronize)

**Steps:**
1. Checkout PR code.
2. Checkout base branch graph.db artifact (or generate it from cache).
3. Run `repo-graph scan` on PR code.
4. Run `repo-graph diff` (new command) to compare PR graph vs base graph.
5. Comment the report on the PR (using `actions/github-script` or similar).

### C4 — Documentation

Add a `CI_CD.md` file in `docs/` explaining:
- How to add the action to a repository.
- How to cache `graph.db` between runs for performance.
- How to interpret the impact report.
- How to configure `fail-on-impact` for critical paths.

---

## Non-Functional Requirements

- Action must complete in < 2 minutes for repositories up to 5k files.
- Report comment must be idempotent — subsequent pushes update the existing comment rather than creating new ones.
- The action must work on `ubuntu-latest`, `windows-latest`, and `macos-latest` runners.
- All existing tests pass without modification.
- New tests must cover the `diff` command logic (≥ 80% coverage on new modules).

---

## Acceptance Criteria

- [ ] The GitHub Action can be referenced from another repo and runs successfully on PRs.
- [ ] A PR comment is posted with the impact report after the action runs.
- [ ] Re-pushing to the PR updates the existing comment instead of creating duplicates.
- [ ] `repo-graph diff graph-base.db graph-pr.db` outputs a structured JSON/Markdown diff.
- [ ] `fail-on-impact: true` causes the workflow to fail when a configured critical node is affected.
- [ ] Existing 172 tests continue to pass.

---

## Out of Scope

- GitLab CI / Bitbucket Pipelines support (GitHub only for this track).
- Automatic graph.db artifact storage in GitHub Packages or external S3.
- Semantic diffing of node bodies (AST-level diff) — structural graph diff only.
- Integration with GitHub Code Scanning or SARIF output.
