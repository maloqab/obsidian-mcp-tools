import { Database } from "./sqlite.js";

export interface FtsResult {
  noteId: number;
  path: string;
  score: number;
  snippet: string;
}

export class FtsIndex {
  constructor(private db: Database) {}

  search(query: string, limit: number = 50): FtsResult[] {
    const stmt = this.db.raw.prepare(`
      SELECT
        n.id as noteId,
        n.path,
        bm25(fts_index, 10, 1) * -1 as score,
        snippet(fts_index, 1, '<mark>', '</mark>', '...', 30) as snippet
      FROM fts_index
      JOIN notes n ON n.id = fts_index.rowid
      WHERE fts_index MATCH ?
      ORDER BY bm25(fts_index, 10, 1)
      LIMIT ?
    `);

    try {
      return stmt.all(query, limit) as FtsResult[];
    } catch {
      // If query is not valid FTS5 syntax, escape and retry
      const escaped = query.replace(/['"]/g, "").replace(/\s+/g, " AND ");
      try {
        return stmt.all(escaped, limit) as FtsResult[];
      } catch {
        return [];
      }
    }
  }
}
