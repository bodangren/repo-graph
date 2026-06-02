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

  it("emits queries edge for useQuery with aliased api root", () => {
    const p = makeProject(`
      export function Dashboard() {
        const projects = useQuery(convexApi.projects.getAll);
        return null;
      }
    `);
    const { edges } = scanFrameworkEdges(p);
    const queries = edges.filter((e) => e.type === "queries");
    expect(queries.length).toBe(1);
    expect(queries[0].target).toBe("function:*:projects.getAll");
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

describe("scanProject placeholder nodes (FR1)", () => {
  it("creates placeholder nodes for dangling renders/uses_hook targets", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/page.tsx", `
      export function Page() {
        return <OtherComponent />;
      }
    `);
    const { nodes, edges } = scanProject(p);
    const rendersEdge = edges.find((e) => e.type === "renders");
    expect(rendersEdge).toBeDefined();

    const placeholder = nodes.find((n) => n.id === rendersEdge!.target);
    expect(placeholder).toBeDefined();
    expect(placeholder!.type).toBe("function");
    expect(placeholder!.name).toBe("OtherComponent");
    expect(placeholder!.tags).toContain("unresolved");
  });

  it("creates placeholder nodes for class extends wildcard targets", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/widget.ts", `
      export class Widget extends BaseWidget {}
    `);
    const { nodes, edges } = scanProject(p);
    const extendsEdge = edges.find((e) => e.type === "extends");
    expect(extendsEdge).toBeDefined();

    const placeholder = nodes.find((n) => n.id === extendsEdge!.target);
    expect(placeholder).toBeDefined();
    expect(placeholder!.type).toBe("class");
    expect(placeholder!.name).toBe("BaseWidget");
    expect(placeholder!.tags).toContain("unresolved");
  });
});

describe("scanSchemas defineTable inside defineSchema (FR2)", () => {
  it("extracts defineTable nested inside defineSchema", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/convex/schema.ts", `
      import { defineSchema, defineTable } from "convex/server";
      import { v } from "convex/values";
      export default defineSchema({
        users: defineTable({
          name: v.string(),
          email: v.string(),
        }),
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
});


describe("scanStringLiterals (FR1)", () => {
  function makeProject(code: string): Project {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/api.ts", code);
    return p;
  }

  it("stores string literal from fetch() in edge metadata", () => {
    const p = makeProject(`
      export async function getLessons() {
        const res = await fetch('/api/lessons');
        return res.json();
      }
    `);
    const { edges } = scanProject(p);
    const fetchEdge = edges.find((e) => e.type === "calls" && e.target.includes("fetch"));
    // For now we expect calls edges to exist with metadata
    // The scanner doesn't yet create calls edges, so this test will fail
    // and guide implementation
    expect(fetchEdge).toBeDefined();
    expect(fetchEdge!.metadata).toBeDefined();
    const meta = JSON.parse(fetchEdge!.metadata!);
    expect(meta.string_literal).toBe("/api/lessons");
  });

  it("stores string literal from router.push() in edge metadata", () => {
    const p = makeProject(`
      export function navigate() {
        router.push('/courses/[id]');
      }
    `);
    const { edges } = scanProject(p);
    const navEdge = edges.find((e) => e.type === "calls" && e.target.includes("push"));
    expect(navEdge).toBeDefined();
    expect(navEdge!.metadata).toBeDefined();
    const meta = JSON.parse(navEdge!.metadata!);
    expect(meta.string_literal).toBe("/courses/[id]");
  });

  it("stores column ref and value ref from eq() in metadata", () => {
    const p = makeProject(`
      export function findLesson(lessonSlug: string) {
        return db.query.lessons.where(eq(scienceLessons.id, lessonSlug));
      }
    `);
    const { edges } = scanProject(p);
    const eqEdge = edges.find((e) => e.type === "calls" && e.target.includes("eq"));
    expect(eqEdge).toBeDefined();
    expect(eqEdge!.metadata).toBeDefined();
    const meta = JSON.parse(eqEdge!.metadata!);
    expect(meta.column_ref).toBe("scienceLessons.id");
    expect(meta.value_ref).toBe("lessonSlug");
  });

  it("does not create metadata for non-string arguments", () => {
    const p = makeProject(`
      export function fetchWithVar(url: string) {
        return fetch(url);
      }
    `);
    const { edges } = scanProject(p);
    const fetchEdge = edges.find((e) => e.type === "calls" && e.target.includes("fetch"));
    if (fetchEdge) {
      expect(fetchEdge.metadata).toBeUndefined();
    }
  });
});


describe("scanParamFlow (FR2)", () => {
  it("creates param nodes and param_flow edges for destructured params", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/handler.ts", `
      export function handler({ lessonId }: { lessonId: string }) {
        const result = db.query(eq(lessons.id, lessonId));
        return result;
      }
    `);
    const { nodes, edges } = scanProject(p);

    const paramNode = nodes.find((n) => n.type === "param" && n.name === "lessonId");
    expect(paramNode).toBeDefined();

    const flowEdges = edges.filter((e) => e.type === "param_flow");
    expect(flowEdges.length).toBeGreaterThan(0);
    expect(flowEdges.some((e) => e.source.includes("lessonId"))).toBe(true);
  });

  it("traces param usage to eq() call site", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/handler.ts", `
      export function getLesson({ lessonId }: { lessonId: string }) {
        return db.select().from(lessons).where(eq(lessons.id, lessonId));
      }
    `);
    const { edges } = scanProject(p);

    const flowEdges = edges.filter((e) => e.type === "param_flow");
    expect(flowEdges.length).toBeGreaterThan(0);
  });
});

describe("scanRoutes (FR3)", () => {
  it("extracts Next.js route from route.ts", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/app/api/lessons/route.ts", `
      export async function GET(request: Request) {
        return Response.json({ lessons: [] });
      }
      export async function POST(request: Request) {
        return Response.json({ created: true });
      }
    `);
    const { nodes } = scanProject(p);

    const routeNodes = nodes.filter((n) => n.type === "route");
    expect(routeNodes.length).toBe(2);
    expect(routeNodes.some((r) => r.name === "GET /api/lessons")).toBe(true);
    expect(routeNodes.some((r) => r.name === "POST /api/lessons")).toBe(true);
  });

  it("extracts dynamic params from Next.js file path", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/app/courses/[id]/page.tsx", `
      export default function CoursePage({ params }: { params: { id: string } }) {
        return <div>Course {params.id}</div>;
      }
    `);
    const { nodes } = scanProject(p);

    const routeNode = nodes.find((n) => n.type === "route");
    expect(routeNode).toBeDefined();
    expect(routeNode!.tags).toContain("param:id");
  });

  it("extracts Hono routes", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/server.ts", `
      import { Hono } from "hono";
      const app = new Hono();
      app.get('/api/lessons', (c) => c.json([]));
      app.post('/api/lessons/:id', (c) => c.json({ created: true }));
    `);
    const { nodes } = scanProject(p);

    const routeNodes = nodes.filter((n) => n.type === "route");
    expect(routeNodes.length).toBe(2);
    expect(routeNodes.some((r) => r.name === "GET /api/lessons")).toBe(true);
    expect(routeNodes.some((r) => r.name === "POST /api/lessons/:id")).toBe(true);
  });

  it("extracts tRPC procedures", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/src/router.ts", `
      import { router } from "./trpc";
      export const appRouter = router({
        lessons: {
          getById: router.query(({ input }) => ({ id: input })),
          create: router.mutation(({ input }) => ({ created: true })),
        },
      });
    `);
    const { nodes } = scanProject(p);

    const routeNodes = nodes.filter((n) => n.type === "route");
    expect(routeNodes.length).toBe(2);
    expect(routeNodes.some((r) => r.name === "QUERY lessons.getById")).toBe(true);
    expect(routeNodes.some((r) => r.name === "MUTATION lessons.create")).toBe(true);
  });

  it("extracts route mode export as tag", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/app/practice/[lessonId]/route.ts", `
      export const mode = 'practice';
      export async function GET(request: Request) {
        return Response.json({ lesson: {} });
      }
    `);
    const { nodes } = scanProject(p);

    const routeNode = nodes.find((n) => n.type === "route");
    expect(routeNode).toBeDefined();
    expect(routeNode!.tags).toContain("mode:practice");
  });

  it("handles recognized mode values (teaching, guided, explore)", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/app/teaching/[id]/route.ts", `
      export const mode = 'teaching';
      export async function GET() { return Response.json({}); }
    `);
    p.createSourceFile("/app/guided/[id]/route.ts", `
      export const mode = 'guided';
      export async function GET() { return Response.json({}); }
    `);
    const { nodes } = scanProject(p);

    const teaching = nodes.find((n) => n.type === "route" && n.filePath.includes("teaching"));
    const guided = nodes.find((n) => n.type === "route" && n.filePath.includes("guided"));
    expect(teaching!.tags).toContain("mode:teaching");
    expect(guided!.tags).toContain("mode:guided");
  });

  it("handles unrecognized mode values", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/app/custom/[id]/route.ts", `
      export const mode = 'custom_value';
      export async function GET() { return Response.json({}); }
    `);
    const { nodes } = scanProject(p);

    const routeNode = nodes.find((n) => n.type === "route");
    expect(routeNode!.tags).toContain("mode:custom_value");
  });

  it("does not add mode tag when no mode export exists", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/app/api/route.ts", `
      export async function GET() { return Response.json({}); }
    `);
    const { nodes } = scanProject(p);

    const routeNode = nodes.find((n) => n.type === "route");
    expect(routeNode).toBeDefined();
    expect(routeNode!.tags?.some((t) => t.startsWith("mode:"))).toBeFalsy();
  });

  it("preserves param tags alongside mode tags", () => {
    const p = new Project({ useInMemoryFileSystem: true });
    p.createSourceFile("/app/practice/[lessonId]/route.ts", `
      export const mode = 'practice';
      export async function GET() { return Response.json({}); }
    `);
    const { nodes } = scanProject(p);

    const routeNode = nodes.find((n) => n.type === "route");
    expect(routeNode!.tags).toContain("param:lessonId");
    expect(routeNode!.tags).toContain("mode:practice");
  });
});
