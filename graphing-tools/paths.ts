import { relative } from "path";

export function toRelativePath(absolutePath: string, root: string): string {
  if (!absolutePath.startsWith(root)) return absolutePath;
  const rel = relative(root, absolutePath);
  return rel.startsWith(".") ? rel : `./${rel}`;
}
