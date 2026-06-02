import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { discoverIncludeFiles } from "./include";

const TMP_DIR = join(import.meta.dir, "__tmp_include_test");

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(join(TMP_DIR, "supabase", "seed"), { recursive: true });
  mkdirSync(join(TMP_DIR, "migrations"), { recursive: true });
  mkdirSync(join(TMP_DIR, "node_modules", "ignored"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("discoverIncludeFiles", () => {
  it("discovers files matching a simple glob", () => {
    writeFileSync(join(TMP_DIR, "supabase", "seed", "users.json"), "{}");
    writeFileSync(join(TMP_DIR, "supabase", "seed", "lessons.json"), "{}");

    const files = discoverIncludeFiles(TMP_DIR, ["supabase/seed/*.json"]);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("users.json"))).toBe(true);
    expect(files.some((f) => f.endsWith("lessons.json"))).toBe(true);
  });

  it("discovers files with ** recursive glob", () => {
    mkdirSync(join(TMP_DIR, "supabase", "seed", "nested"), { recursive: true });
    writeFileSync(join(TMP_DIR, "supabase", "seed", "top.json"), "{}");
    writeFileSync(join(TMP_DIR, "supabase", "seed", "nested", "deep.json"), "{}");

    const files = discoverIncludeFiles(TMP_DIR, ["supabase/seed/**/*.json"]);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("top.json"))).toBe(true);
    expect(files.some((f) => f.endsWith("deep.json"))).toBe(true);
  });

  it("applies multiple patterns additively", () => {
    writeFileSync(join(TMP_DIR, "supabase", "seed", "data.json"), "{}");
    writeFileSync(join(TMP_DIR, "migrations", "001.sql"), "SELECT 1");

    const files = discoverIncludeFiles(TMP_DIR, [
      "supabase/seed/**/*.json",
      "migrations/**/*.sql",
    ]);
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith("data.json"))).toBe(true);
    expect(files.some((f) => f.endsWith("001.sql"))).toBe(true);
  });

  it("excludes files inside SKIP_DIRS (node_modules)", () => {
    writeFileSync(join(TMP_DIR, "node_modules", "ignored", "pkg.json"), "{}");
    writeFileSync(join(TMP_DIR, "supabase", "seed", "real.json"), "{}");

    const files = discoverIncludeFiles(TMP_DIR, ["**/*.json"]);
    expect(files.some((f) => f.includes("node_modules"))).toBe(false);
    expect(files.some((f) => f.endsWith("real.json"))).toBe(true);
  });

  it("returns empty array for patterns matching zero files", () => {
    const files = discoverIncludeFiles(TMP_DIR, ["nonexistent/**/*.xyz"]);
    expect(files).toHaveLength(0);
  });

  it("returns empty array for empty patterns", () => {
    const files = discoverIncludeFiles(TMP_DIR, []);
    expect(files).toHaveLength(0);
  });

  it("deduplicates files matched by multiple patterns", () => {
    writeFileSync(join(TMP_DIR, "supabase", "seed", "data.json"), "{}");

    const files = discoverIncludeFiles(TMP_DIR, [
      "supabase/seed/*.json",
      "supabase/**/*.json",
    ]);
    const dataFiles = files.filter((f) => f.endsWith("data.json"));
    expect(dataFiles).toHaveLength(1);
  });
});
