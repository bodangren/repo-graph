import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { scanProject } from "./scanner";

export function updateFiles(db: Database, project: Project, filePaths: string[]): {
  filesUpdated: number;
  nodesDeleted: number;
  nodesInserted: number;
  edgesDeleted: number;
  edgesInserted: number;
} {
  const stats = {
    filesUpdated: 0,
    nodesDeleted: 0,
    nodesInserted: 0,
    edgesDeleted: 0,
    edgesInserted: 0,
  };

  const deleteNodes = db.prepare("DELETE FROM nodes WHERE file_path = ?");
  const deleteEdges = db.prepare("DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = ?) OR target IN (SELECT id FROM nodes WHERE file_path = ?)");
  const insertNode = db.prepare(`INSERT INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags, layer_id, package_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEdge = db.prepare(`INSERT INTO edges (source, target, type, direction, weight, metadata)
    VALUES (?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    for (const filePath of filePaths) {
      const absPath = project.getFileSystem().readDirSync(".").includes(filePath)
        ? filePath
        : filePath; // TODO: resolve absolute path

      const edgesDeleted = deleteEdges.run(absPath, absPath).changes;
      const nodesDeleted = deleteNodes.run(absPath).changes;

      stats.nodesDeleted += nodesDeleted;
      stats.edgesDeleted += edgesDeleted;

      // Re-parse only this file
      let sourceFile = project.getSourceFile(absPath);
      if (!sourceFile) {
        try {
          sourceFile = project.addSourceFileAtPath(absPath);
        } catch {
          continue;
        }
      }
      if (!sourceFile) continue;

      // Create a temporary project with just this file
      const tempProject = new Project();
      tempProject.addSourceFileAtPath(absPath);
      const { nodes, edges } = scanProject(tempProject);

      for (const node of nodes) {
        insertNode.run(
          node.id, node.type, node.name, node.filePath,
          node.lineStart ?? null, node.lineEnd ?? null,
          node.summary ?? null,
          node.tags ? JSON.stringify(node.tags) : null,
          node.layerId ?? null,
          node.packageId ?? null
        );
        stats.nodesInserted++;
      }

      for (const edge of edges) {
        insertEdge.run(edge.source, edge.target, edge.type, edge.direction, edge.weight ?? 0.5, edge.metadata ?? null);
        stats.edgesInserted++;
      }

      stats.filesUpdated++;
    }
  })();

  return stats;
}
