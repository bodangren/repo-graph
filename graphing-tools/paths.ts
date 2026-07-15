import { relative } from "path";

/**
 * Convert an absolute path to the repository's stable relative form.
 *
 * @param absolutePath Path to relativize.
 * @param root Project root used as the base.
 * @returns A path beginning with `./` unless it is the root itself.
 */
export function toRelativePath(absolutePath: string, root: string): string {
  if (!absolutePath.startsWith(root)) return absolutePath;
  const rel = relative(root, absolutePath);
  return rel.startsWith(".") ? rel : `./${rel}`;
}
