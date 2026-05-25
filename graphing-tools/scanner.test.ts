import { describe, it, expect, beforeAll } from "bun:test";
import { Project, SyntaxKind } from "ts-morph";
import { scanProject, scanSchemas, scanFrameworkEdges } from "./scanner";
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

  describe("package labeling (S3)", () => {
    it("labels nodes with package_id when packageMap is provided", () => {
      const pkgProject = new Project({ useInMemoryFileSystem: true });
      pkgProject.createSourceFile("/frontend/src/app.ts", `export function main() {}`);
      pkgProject.createSourceFile("/backend/src/api.ts", `export function handle() {}`);

      const packageMap = new Map<string, string>([
        ["/frontend/src/app.ts", "frontend"],
        ["/backend/src/api.ts", "backend"],
      ]);

      const { nodes } = scanProject(pkgProject, packageMap);
      const appFile = nodes.find((n) => n.name === "app.ts" && n.type === "file");
      const apiFile = nodes.find((n) => n.name === "api.ts" && n.type === "file");
      expect(appFile?.packageId).toBe("frontend");
      expect(apiFile?.packageId).toBe("backend");
    });

    it("uses 'root' as fallback when file not in packageMap", () => {
      const pkgProject = new Project({ useInMemoryFileSystem: true });
      pkgProject.createSourceFile("/src/app.ts", `export function main() {}`);
      const packageMap = new Map<string, string>();
      const { nodes } = scanProject(pkgProject, packageMap);
      const appFile = nodes.find((n) => n.name === "app.ts");
      expect(appFile?.packageId).toBe("root");
    });
  });
});

describe("scanSchemas (S1)", () => {
  function makeProject(code: string): Project {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/schema.ts", code);
    return p;
  }

  it("extracts defineTable call as schema node with field children", () => {
    const p = makeProject(`
      import { defineTable } from "convex/server";
      import { v } from "convex/values";
      export const users = defineTable({
        name: v.string(),
        email: v.string(),
      });
    `);
    const { nodes, edges } = scanSchemas(p);
    const schemaNode = nodes.find((n) => n.type === "schema" && n.name === "users");
    expect(schemaNode).toBeDefined();

    const fieldNodes = nodes.filter((n) => n.type === "field");
    expect(fieldNodes.length).toBe(2);
    expect(fieldNodes.some((f) => f.name === "users.name")).toBe(true);
    expect(fieldNodes.some((f) => f.name === "users.email")).toBe(true);

    const hasFieldEdges = edges.filter((e) => e.type === "has_field");
    expect(hasFieldEdges.length).toBe(2);
  });

  it("extracts z.object call as schema node with field children", () => {
    const p = makeProject(`
      import { z } from "zod";
      export const UserSchema = z.object({
        name: z.string(),
        age: z.number(),
      });
    `);
    const { nodes, edges } = scanSchemas(p);
    const schemaNode = nodes.find((n) => n.type === "schema" && n.name === "UserSchema");
    expect(schemaNode).toBeDefined();

    const fieldNodes = nodes.filter((n) => n.type === "field");
    expect(fieldNodes.length).toBe(2);
    expect(fieldNodes.some((f) => f.name === "UserSchema.name")).toBe(true);

    const hasFieldEdges = edges.filter((e) => e.type === "has_field");
    expect(hasFieldEdges.length).toBe(2);
  });

  it("extracts exported const object literal as config schema", () => {
    const p = makeProject(`
      export const config = {
        apiUrl: "https://api.example.com",
        timeout: 30,
      };
    `);
    const { nodes, edges } = scanSchemas(p);
    const schemaNode = nodes.find((n) => n.type === "schema" && n.name === "config");
    expect(schemaNode).toBeDefined();

    const fieldNodes = nodes.filter((n) => n.type === "field");
    expect(fieldNodes.length).toBe(2);
    expect(fieldNodes.some((f) => f.name === "config.apiUrl")).toBe(true);
    expect(fieldNodes.some((f) => f.name === "config.timeout")).toBe(true);

    const hasFieldEdges = edges.filter((e) => e.type === "has_field");
    expect(hasFieldEdges.length).toBe(2);
  });

  it("creates references edge for v.id('tableName')", () => {
    const p = makeProject(`
      import { defineTable } from "convex/server";
      import { v } from "convex/values";
      export const users = defineTable({
        name: v.string(),
        projectId: v.id("projects"),
      });
    `);
    const { edges } = scanSchemas(p);
    const refEdges = edges.filter((e) => e.type === "references");
    expect(refEdges.length).toBe(1);
    expect(refEdges[0].target).toBe("schema:*:projects");
  });

  it("skips non-exported const objects", () => {
    const p = makeProject(`
      const internal = { secret: "xyz" };
    `);
    const { nodes } = scanSchemas(p);
    expect(nodes.length).toBe(0);
  });
});

describe("scanFrameworkEdges (S2)", () => {
  function makeProject(code: string): Project {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/comp.tsx", code);
    return p;
  }

  it("emits renders edge for JSX component references", () => {
    const p = makeProject(`
      function Child() { return null; }
      export function Parent() {
        return <Child />;
      }
    `);
    const { edges } = scanFrameworkEdges(p);
    const renders = edges.filter((e) => e.type === "renders");
    expect(renders.length).toBe(1);
    expect(renders[0].source).toContain(":Parent");
    expect(renders[0].target).toContain(":Child");
  });

  it("emits uses_hook edge for useHook() calls", () => {
    const p = makeProject(`
      function useAuth() { return {}; }
      export function Dashboard() {
        const user = useAuth();
        return null;
      }
    `);
    const { edges } = scanFrameworkEdges(p);
    const hooks = edges.filter((e) => e.type === "uses_hook");
    expect(hooks.length).toBe(1);
    expect(hooks[0].source).toContain(":Dashboard");
    expect(hooks[0].target).toContain(":useAuth");
  });

  it("emits queries edge for useQuery(api.module.fn)", () => {
    const p = makeProject(`
      export function Dashboard() {
        const projects = useQuery(api.projects.getAll);
        return null;
      }
    `);
    const { edges } = scanFrameworkEdges(p);
    const queries = edges.filter((e) => e.type === "queries");
    expect(queries.length).toBe(1);
    expect(queries[0].source).toContain(":Dashboard");
    expect(queries[0].target).toBe("function:*:projects.getAll");
  });

  it("emits mutates edge for useMutation(api.module.fn)", () => {
    const p = makeProject(`
      export function Dashboard() {
        const update = useMutation(api.projects.update);
        return null;
      }
    `);
    const { edges } = scanFrameworkEdges(p);
    const mutates = edges.filter((e) => e.type === "mutates");
    expect(mutates.length).toBe(1);
    expect(mutates[0].source).toContain(":Dashboard");
    expect(mutates[0].target).toBe("function:*:projects.update");
  });

  it("ignores intrinsic JSX elements like div", () => {
    const p = makeProject(`
      export function Box() {
        return <div>hello</div>;
      }
    `);
    const { edges } = scanFrameworkEdges(p);
    const renders = edges.filter((e) => e.type === "renders");
    expect(renders.length).toBe(0);
  });
});
