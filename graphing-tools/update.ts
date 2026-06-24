import { Database } from "bun:sqlite";
import { Project } from "ts-morph";
import { resolve } from "path";
import { existsSync, statSync } from "fs";
import { scanProject } from "./scanner";
import { recordFileMetadata, deleteFileData } from "./files";

export function updateFiles(db: Database, project: Project, filePaths: string[]): {
  filesUpdated: number;
  nodesDeleted: number;
  nodesInserted: number;
  edgesDeleted: number;
  edgesInserted: number;
  filesDeleted: number;
} {
  const stats = {
    filesUpdated: 0,
    nodesDeleted: 0,
    nodesInserted: 0,
    edgesDeleted: 0,
    edgesInserted: 0,
    filesDeleted: 0,
  };

  const deleteNodes = db.prepare("DELETE FROM nodes WHERE file_path = ?");
  const deleteEdges = db.prepare("DELETE FROM edges WHERE source IN (SELECT id FROM nodes WHERE file_path = ?) OR target IN (SELECT id FROM nodes WHERE file_path = ?)");
  const insertNode = db.prepare(`INSERT OR REPLACE INTO nodes (id, type, name, file_path, line_start, line_end, summary, tags, complexity, layer_id, package_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertEdge = db.prepare(`INSERT INTO edges (source, target, type, direction, weight, metadata)
    VALUES (?, ?, ?, ?, ?, ?)`);

  db.transaction(() => {
    for (const filePath of filePaths) {
      const absPath = resolve(filePath);

      // If the file no longer exists on disk, drop its graph data
      // entirely and record a `files` removal.
      if (!existsSync(absPath)) {
        const removed = deleteFileData(db, absPath);
        stats.nodesDeleted += removed.nodesDeleted;
        stats.edgesDeleted += removed.edgesDeleted;
        stats.filesDeleted += removed.filesDeleted;
        continue;
      }

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
          node.complexity ?? null,
          node.layerId ?? null,
          node.packageId ?? null
        );
        stats.nodesInserted++;
      }

      for (const edge of edges) {
        insertEdge.run(edge.source, edge.target, edge.type, edge.direction, edge.weight ?? 0.5, edge.metadata ?? null);
        stats.edgesInserted++;
      }

      // Record file metadata for freshness tracking.
      let stat;
      try {
        stat = statSync(absPath);
      } catch {
        stat = null;
      }
      const meta = recordFileMetadata(db, undefined, absPath, sourceFile);
      if (!meta && stat) {
        // Fallback: record minimal metadata if recordFileMetadata failed
        // (e.g. files table missing). No-op here; the schema.ts
        // additive migration will create it on next createSchema.
      }
      stats.filesUpdated++;
    }
  })();

  return stats;
}
