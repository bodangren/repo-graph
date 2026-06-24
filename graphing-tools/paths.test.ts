import { describe, it, expect } from "bun:test";
import { toRelativePath } from "./paths";

describe("toRelativePath", () => {
  it("strips root prefix and adds ./", () => {
    const result = toRelativePath("/home/user/project/src/a.ts", "/home/user/project");
    expect(result).toBe("./src/a.ts");
  });

  it("returns ./ for root-level file", () => {
    const result = toRelativePath("/home/user/project/index.ts", "/home/user/project");
    expect(result).toBe("./index.ts");
  });

  it("returns original path if outside root", () => {
    const result = toRelativePath("/other/path/file.ts", "/home/user/project");
    expect(result).toBe("/other/path/file.ts");
  });
});
