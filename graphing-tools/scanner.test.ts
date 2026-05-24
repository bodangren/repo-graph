import { describe, it, expect, beforeAll } from "bun:test";
import { Project } from "ts-morph";
import { scanProject } from "./scanner";
import type { GraphNode, GraphEdge } from "./contract";

describe("scanProject", () => {
  let project: Project;
  let result: { nodes: GraphNode[]; edges: GraphEdge[] };

  beforeAll(() => {
    project = new Project({
      tsConfigFilePath: "./graphing-tools/fixtures/sample-project/tsconfig.json",
    });
    result = scanProject(project);
  });

  describe("file nodes", () => {
    it("extracts one file node per source file", () => {
      const files = result.nodes.filter((n) => n.type === "file");
      expect(files.length).toBe(3);
      expect(files.map((f) => f.name)).toContain("utils.ts");
      expect(files.map((f) => f.name)).toContain("auth.ts");
      expect(files.map((f) => f.name)).toContain("types.ts");
    });
  });

  describe("function nodes", () => {
    it("extracts named function declarations", () => {
      const funcs = result.nodes.filter((n) => n.type === "function");
      expect(funcs.some((f) => f.name === "formatName")).toBe(true);
    });

    it("extracts arrow functions assigned to const", () => {
      const funcs = result.nodes.filter((n) => n.type === "function");
      expect(funcs.some((f) => f.name === "calculateSum")).toBe(true);
    });

    it("extracts JSDoc summary for functions", () => {
      const formatName = result.nodes.find((n) => n.name === "formatName");
      expect(formatName?.summary).toContain("Formats a user name");
    });

    it("extracts line numbers for functions", () => {
      const formatName = result.nodes.find((n) => n.name === "formatName");
      expect(formatName?.lineStart).toBeGreaterThan(0);
      expect(formatName?.lineEnd).toBeGreaterThan(formatName!.lineStart!);
    });
  });

  describe("class nodes", () => {
    it("extracts class declarations", () => {
      const classes = result.nodes.filter((n) => n.type === "class");
      expect(classes.some((c) => c.name === "User")).toBe(true);
      expect(classes.some((c) => c.name === "Admin")).toBe(true);
    });

    it("extracts line numbers for classes", () => {
      const user = result.nodes.find((n) => n.name === "User");
      expect(user?.lineStart).toBeGreaterThan(0);
    });
  });

  describe("interface nodes", () => {
    it("extracts interface declarations", () => {
      const interfaces = result.nodes.filter((n) => n.type === "interface");
      expect(interfaces.some((i) => i.name === "Authenticatable")).toBe(true);
      expect(interfaces.some((i) => i.name === "UserProfile")).toBe(true);
      expect(interfaces.some((i) => i.name === "AdminProfile")).toBe(true);
    });
  });

  describe("type alias nodes", () => {
    it("extracts type alias declarations", () => {
      const types = result.nodes.filter((n) => n.type === "type_alias");
      expect(types.some((t) => t.name === "UserID")).toBe(true);
      expect(types.some((t) => t.name === "UserRole")).toBe(true);
    });
  });

  describe("import edges", () => {
    it("creates import edges between files", () => {
      const authFile = result.nodes.find((n) => n.name === "auth.ts" && n.type === "file");
      const importEdges = result.edges.filter(
        (e) => e.source === authFile?.id && e.type === "imports"
      );
      expect(importEdges.length).toBeGreaterThan(0);
    });
  });

  describe("contains edges", () => {
    it("creates contains edges from file to functions", () => {
      const utilsFile = result.nodes.find((n) => n.name === "utils.ts" && n.type === "file");
      const contains = result.edges.filter(
        (e) => e.source === utilsFile?.id && e.type === "contains"
      );
      expect(contains.length).toBeGreaterThan(0);
    });

    it("creates contains edges from file to classes", () => {
      const authFile = result.nodes.find((n) => n.name === "auth.ts" && n.type === "file");
      const contains = result.edges.filter(
        (e) => e.source === authFile?.id && e.type === "contains"
      );
      expect(contains.some((e) => e.target.includes(":User"))).toBe(true);
    });
  });

  describe("extends edges", () => {
    it("creates extends edges for class inheritance", () => {
      const admin = result.nodes.find((n) => n.name === "Admin" && n.type === "class");
      const extendsEdges = result.edges.filter(
        (e) => e.source === admin?.id && e.type === "extends"
      );
      expect(extendsEdges.length).toBeGreaterThan(0);
    });

    it("creates extends edges for interface inheritance", () => {
      const adminProfile = result.nodes.find((n) => n.name === "AdminProfile" && n.type === "interface");
      const extendsEdges = result.edges.filter(
        (e) => e.source === adminProfile?.id && e.type === "extends"
      );
      expect(extendsEdges.length).toBeGreaterThan(0);
    });
  });

  describe("implements edges", () => {
    it("creates implements edges for class → interface", () => {
      const user = result.nodes.find((n) => n.name === "User" && n.type === "class");
      const implEdges = result.edges.filter(
        (e) => e.source === user?.id && e.type === "implements"
      );
      expect(implEdges.length).toBeGreaterThan(0);
    });
  });
});
