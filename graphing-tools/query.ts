import { Database } from "bun:sqlite";

export function runQuery(db: Database, sql: string): { columns: string[]; rows: unknown[][] } {
  const stmt = db.prepare(sql);
  const result = stmt.all() as Record<string, unknown>[];

  if (result.length === 0) {
    return { columns: [], rows: [] };
  }

  const columns = Object.keys(result[0]);
  const rows = result.map((row) => columns.map((col) => row[col] ?? null));
  return { columns, rows };
}

export function formatTable(columns: string[], rows: unknown[][]): string {
  if (columns.length === 0) return "(no results)";

  const colWidths = columns.map((col, i) => {
    const maxDataWidth = rows.reduce((max, row) => {
      const cell = String(row[i] ?? "NULL");
      return Math.max(max, cell.length);
    }, 0);
    return Math.max(col.length, maxDataWidth);
  });

  const formatRow = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ");

  const lines: string[] = [];
  lines.push(formatRow(columns));
  lines.push(colWidths.map((w) => "-".repeat(w)).join("-+-"));
  for (const row of rows) {
    lines.push(formatRow(row.map((cell) => String(cell ?? "NULL"))));
  }

  return lines.join("\n");
}

export function formatJson(columns: string[], rows: unknown[][]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}
