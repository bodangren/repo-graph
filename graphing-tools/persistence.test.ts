import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Project } from "ts-morph";
import { createSchema } from "./schema";
import { scanProject } from "./scanner";
import {
  packageMapForProject,
  persistGraph,
  persistGraphFromFiles,
  persistSnapshotFromFilesAtomically,
  scanAndPersist,
  scanAndPersistAtomically,
} from "./persistence";
import { searchNodes } from "./search";

function makeProject(): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  project.createSourceFile("/project/src/lib.ts", `
    /**
     * Adds two values across multiple lines.
     * @param left - Left value.
     * @param right - Right value.
     * @returns The sum.
     * @deprecated Use addValues2 instead.
     */
    export function addValues(left: number, right: number): number {
      return left + right;
    }
  `);
  project.createSourceFile("/project/src/app.ts", `
    import { addValues } from "./lib";
    export function calculate(): number { return addValues(1, 2); }
  `);
  return project;
}

describe("shared graph persistence", () => {
  it("persists structured documentation, imports, and ordinary call edges", () => {
    const project = makeProject();
    const db = new Database(":memory:");
    createSchema(db);

    const snapshot = scanProject(project);
    persistGraph(db, snapshot, project, { projectRoot: "/project" });

    const documented = db.prepare("SELECT summary, documentation FROM nodes WHERE name = 'addValues'").get() as {
      summary: string;
      documentation: string;
    };
    const docs = JSON.parse(documented.documentation);
    expect(documented.summary).toBe("Adds two values across multiple lines.");
    expect(docs.description).toBe("Adds two values across multiple lines.");
    expect(docs.params).toEqual([
      { name: "left", description: "- Left value." },
      { name: "right", description: "- Right value." },
    ]);
    expect(docs.returns).toBe("The sum.");
    expect(docs.tags.some((tag: { name: string }) => tag.name === "deprecated")).toBe(true);

    const caller = db.prepare(`
      SELECT COUNT(*) AS count FROM edges
      WHERE type = 'calls' AND source LIKE '%app.ts:calculate' AND target LIKE '%lib.ts:addValues'
    `).get() as { count: number };
    expect(caller.count).toBe(1);
    expect(searchNodes(db, "deprecated").some((node) => node.name === "addValues")).toBe(true);

    // A repeated full persistence is idempotent and keeps one row per node.
    persistGraph(db, snapshot, project, { projectRoot: "/project" });
    const count = (db.prepare("SELECT COUNT(*) AS count FROM nodes").get() as { count: number }).count;
    expect(count).toBe(snapshot.nodes.length);
    db.close();
  }, 15_000);

  it("does not publish a failed project-free atomic snapshot over a valid graph", () => {
    const project = makeProject();
    const path = `/tmp/repo-graph-atomic-${process.pid}.db`;
    const db = new Database(path);
    createSchema(db);
    db.exec(
      "INSERT INTO nodes (id, type, name, file_path) VALUES ('sentinel', 'file', 'sentinel.ts', '/project/sentinel.ts')",
    );
    db.close();

    const duplicate = {
      id: "duplicate",
      type: "file" as const,
      name: "one.ts",
      filePath: "/project/one.ts",
    };
    expect(() => persistSnapshotFromFilesAtomically(
      path,
      { nodes: [duplicate, { ...duplicate }], edges: [] },
      project.getSourceFiles().map((sourceFile) => sourceFile.getFilePath()),
      { projectRoot: "/project" },
    )).toThrow();

    const preserved = new Database(path);
    expect(
      preserved.prepare("SELECT name FROM nodes WHERE id = 'sentinel'").get(),
    ).toEqual({ name: "sentinel.ts" });
    preserved.close();
    unlinkSync(path);
  });

  it("scans through both atomic and open-database persistence paths", () => {
    const project = makeProject();
    const path = `/tmp/repo-graph-persistence-${process.pid}.db`;
    const snapshot = scanAndPersistAtomically(path, project, { projectRoot: "/project" });
    expect(snapshot.nodes.length).toBeGreaterThan(0);

    const persisted = new Database(path);
    expect((persisted.prepare("SELECT COUNT(*) AS count FROM nodes").get() as { count: number }).count).toBe(snapshot.nodes.length);
    const second = scanAndPersist(persisted, project, { projectRoot: "/project" });
    expect(second.nodes.length).toBe(snapshot.nodes.length);
    persisted.close();
    unlinkSync(path);

    const packageMap = packageMapForProject(project, new Map([[project.getSourceFiles()[0].getFilePath(), "lib"]]));
    expect(packageMap.get(project.getSourceFiles()[0].getFilePath())).toBe("lib");
    expect(packageMap.get(project.getSourceFiles()[1].getFilePath())).toBe("root");
  }, 15_000);

  it("records file metadata from explicit batched source paths", () => {
    const root = mkdtempSync(join(tmpdir(), "repo-graph-file-paths-"));
    const filePath = join(root, "source.ts");
    try {
      writeFileSync(filePath, "export const value = 1;\n");
      const db = new Database(":memory:");
      createSchema(db);
      persistGraphFromFiles(db, {
        nodes: [{
          id: `file:${filePath}`,
          type: "file",
          name: "source.ts",
          filePath,
        }],
        edges: [],
      }, [filePath], { projectRoot: root });

      const row = db.prepare(
        "SELECT path, node_count FROM files WHERE path = ?",
      ).get(filePath);
      expect(row).toEqual({ path: filePath, node_count: 1 });
      db.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
