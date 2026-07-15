import { readdirSync, statSync } from "fs";
import { join, resolve } from "path";

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".turbo", "out", "coverage"]);
const MAX_DEPTH = 20;

/**
 * Discover files matching custom glob patterns relative to the project root.
 *
 * @param projectDir Root directory to search.
 * @param patterns Glob patterns to expand.
 * @returns Unique absolute paths in deterministic discovery order.
 */
export function discoverIncludeFiles(projectDir: string, patterns: string[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const files = resolveGlob(projectDir, pattern);
    for (const f of files) {
      if (!seen.has(f)) {
        seen.add(f);
        results.push(f);
      }
    }
  }

  return results;
}

/**
 * Resolve a simple glob pattern relative to a root directory.
 * Supports: ** (recursive), * (wildcard in segment), ? (single char).
 */
function resolveGlob(root: string, pattern: string): string[] {
  const results: string[] = [];
  const parts = pattern.split("/");

  function walk(dir: string, partIndex: number, depth: number): void {
    if (partIndex >= parts.length || depth > MAX_DEPTH) return;

    const part = parts[partIndex];
    const isLast = partIndex === parts.length - 1;

    if (part === "**") {
      // Match zero or more directories — try the rest of the pattern at this level
      walk(dir, partIndex + 1, depth);
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const entry of entries) {
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
          walk(join(dir, entry.name), partIndex, depth + 1);
        }
      }
      return;
    }

    // Regular segment or wildcard
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { return; }

    const regex = globToRegex(part);

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      if (regex.test(entry.name)) {
        const fullPath = join(dir, entry.name);
        if (isLast) {
          if (entry.isFile()) {
            results.push(resolve(fullPath));
          }
        } else if (entry.isDirectory()) {
          walk(fullPath, partIndex + 1, depth + 1);
        }
      }
    }
  }

  walk(root, 0, 0);
  return results;
}

/**
 * Convert a single glob segment to a regex.
 */
function globToRegex(segment: string): RegExp {
  let regexStr = "^";
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === "*") {
      regexStr += ".*";
    } else if (c === "?") {
      regexStr += ".";
    } else if (".+^${}()|[]\\".includes(c)) {
      regexStr += "\\" + c;
    } else {
      regexStr += c;
    }
  }
  regexStr += "$";
  return new RegExp(regexStr);
}
