import { Database } from "../../index/sqlite.js";
import { Vault } from "../../core/vault.js";
import { executeQuery } from "./executor.js";
import type { DataviewResult } from "./types.js";

// --- IMPORTANT: Read the existing executor.ts to understand what executeQuery returns ---

export function dataviewQuery(
  db: Database,
  vault: Vault,
  options: { query: string },
): DataviewResult {
  return executeQuery(options.query, db, vault);
}

export function dataviewFields(db: Database): { key: string; count: number; types: string[]; examples: string[] }[] {
  const rows = db.raw.prepare(`
    SELECT key, type, value, COUNT(*) as count
    FROM inline_fields
    GROUP BY key, type
    ORDER BY count DESC
  `).all() as { key: string; type: string; value: string; count: number }[];

  // Aggregate by key
  const keyMap = new Map<string, { count: number; types: Set<string>; examples: string[] }>();
  for (const row of rows) {
    const existing = keyMap.get(row.key);
    if (existing) {
      existing.count += row.count;
      existing.types.add(row.type);
      if (existing.examples.length < 3) existing.examples.push(row.value);
    } else {
      keyMap.set(row.key, {
        count: row.count,
        types: new Set([row.type]),
        examples: [row.value],
      });
    }
  }

  return Array.from(keyMap.entries()).map(([key, data]) => ({
    key,
    count: data.count,
    types: [...data.types],
    examples: data.examples,
  }));
}

export function dataviewEval(
  db: Database,
  vault: Vault,
  options: { expression: string; notePath: string },
): unknown {
  // Build a TABLE query that evaluates the expression for this specific note
  // This is a lightweight way to evaluate an expression in the context of a note
  const query = `TABLE WITHOUT ID ${options.expression} WHERE file.path = "${options.notePath}"`;
  const result = executeQuery(query, db, vault);
  if (result.rows && result.rows.length > 0) {
    const values = Object.values(result.rows[0]);
    return values.length === 1 ? values[0] : values;
  }
  return null;
}
