import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Phase 2 Red — Hook installation tests ───────────────────────────────────

describe("installHooks — hook installation", () => {
  let tmpDir: string;
  let hooksDir: string;
  let installHooks: ((gitDir: string) => Promise<{ created?: string[]; overwritten?: string[]; warnings?: string[] }>) | undefined;
  let warnings: string[];
  let origWarn: typeof console.warn;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "installHooks-"));
    hooksDir = path.join(tmpDir, ".git", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    warnings = [];
    origWarn = console.warn;
    console.warn = (msg: unknown) => { warnings.push(String(msg)); };

    try {
      const mod = await import("./hooks");
      installHooks = mod.installHooks;
    } catch {
      installHooks = undefined;
    }
  });

  afterEach(() => {
    console.warn = origWarn;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // H1: installHooks creates .git/hooks/pre-commit with the correct command
  it("H1: installHooks creates pre-commit with correct command", async () => {
    expect(installHooks).toBeDefined();
    const result = await installHooks!(path.join(tmpDir, ".git"));
    expect(result).toBeDefined();

    const preCommitPath = path.join(hooksDir, "pre-commit");
    expect(fs.existsSync(preCommitPath)).toBe(true);

    const content = fs.readFileSync(preCommitPath, "utf-8");
    expect(content.startsWith("#!/bin/sh")).toBe(true);
    expect(content).toContain("git diff --cached --name-only --diff-filter=ACM");
  });

  // H2: installHooks creates .git/hooks/post-checkout with the correct command
  it("H2: installHooks creates post-checkout with correct command", async () => {
    expect(installHooks).toBeDefined();
    const result = await installHooks!(path.join(tmpDir, ".git"));
    expect(result).toBeDefined();

    const postCheckoutPath = path.join(hooksDir, "post-checkout");
    expect(fs.existsSync(postCheckoutPath)).toBe(true);

    const content = fs.readFileSync(postCheckoutPath, "utf-8");
    expect(content.startsWith("#!/bin/sh")).toBe(true);
    expect(content).toContain('git diff --name-only "$1" "$2"');
  });

  // H3: installHooks is idempotent — overwrites existing repo-graph hooks
  it("H3: installHooks overwrites existing repo-graph hooks on second run", async () => {
    expect(installHooks).toBeDefined();
    const gitDir = path.join(tmpDir, ".git");

    const firstResult = await installHooks!(gitDir);
    expect(firstResult).toBeDefined();

    const contentFirst = fs.readFileSync(path.join(hooksDir, "pre-commit"), "utf-8");

    const secondResult = await installHooks!(gitDir);
    expect(secondResult).toBeDefined();
    expect(secondResult.overwritten).toBeDefined();
    expect(secondResult.overwritten).toContain("pre-commit");
    expect(secondResult.overwritten).toContain("post-checkout");

    const contentSecond = fs.readFileSync(path.join(hooksDir, "pre-commit"), "utf-8");
    expect(contentSecond).toBe(contentFirst);
  });

  // H4: installHooks warns when overwriting non-repo-graph content
  it("H4: installHooks warns on non-repo-graph existing content", async () => {
    expect(installHooks).toBeDefined();
    const gitDir = path.join(tmpDir, ".git");

    fs.writeFileSync(path.join(hooksDir, "pre-commit"), '#!/bin/sh\necho "hand-rolled"\n');

    const result = await installHooks!(gitDir);
    expect(result).toBeDefined();
    expect(result.warnings).toBeDefined();

    const overwriteWarning = (result.warnings ?? []).find((w: string) =>
      w.includes("Overwriting existing hook")
    );
    expect(overwriteWarning).toBeDefined();
  });

  // H5: installHooks makes generated scripts executable (mode 0755)
  it("H5: installHooks makes generated scripts executable", async () => {
    expect(installHooks).toBeDefined();
    const gitDir = path.join(tmpDir, ".git");

    await installHooks!(gitDir);

    const preCommitPath = path.join(hooksDir, "pre-commit");
    const postCheckoutPath = path.join(hooksDir, "post-checkout");

    const preCommitStat = fs.statSync(preCommitPath);
    const postCheckoutStat = fs.statSync(postCheckoutPath);

    const preCommitMode = (preCommitStat.mode & 0o777).toString(8);
    const postCheckoutMode = (postCheckoutStat.mode & 0o777).toString(8);

    expect(preCommitMode).toBe("755");
    expect(postCheckoutMode).toBe("755");
  });

  // H6: Generated pre-commit invokes the correct repo-graph update command
  it("H6: pre-commit invokes repo-graph update with staged file list", async () => {
    expect(installHooks).toBeDefined();
    const gitDir = path.join(tmpDir, ".git");

    await installHooks!(gitDir);

    const content = fs.readFileSync(path.join(hooksDir, "pre-commit"), "utf-8");
    expect(content).toContain("repo-graph update graph.db");
    expect(content).toContain("git diff --cached --name-only --diff-filter=ACM");
    expect(content).not.toContain("[[");
    expect(content).not.toContain("local ");
  });

  // H7: Generated post-checkout invokes the correct repo-graph update command
  it("H7: post-checkout invokes repo-graph update with changed file list", async () => {
    expect(installHooks).toBeDefined();
    const gitDir = path.join(tmpDir, ".git");

    await installHooks!(gitDir);

    const content = fs.readFileSync(path.join(hooksDir, "post-checkout"), "utf-8");
    expect(content).toContain("repo-graph update graph.db");
    expect(content).toContain('git diff --name-only "$1" "$2"');
    expect(content).not.toContain("[[");
    expect(content).not.toContain("local ");
  });
});
