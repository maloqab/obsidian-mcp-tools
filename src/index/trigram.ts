import { Database } from "./sqlite.js";

export interface TrigramResult {
  noteId: number;
  path: string;
  score: number;
}

export class TrigramIndex {
  constructor(private db: Database) {}

  private extractTrigrams(text: string): string[] {
    const normalized = text.toLowerCase().replace(/\s+/g, " ");
    const trigrams: string[] = [];
    for (let i = 0; i <= normalized.length - 3; i++) {
      trigrams.push(normalized.substring(i, i + 3));
    }
    return [...new Set(trigrams)];
  }

  buildIndex(): void {
    this.db.raw.prepare("DELETE FROM trigrams").run();

    const notes = this.db.getAllNotes();
    const insertStmt = this.db.raw.prepare(
      "INSERT INTO trigrams (note_id, trigram) VALUES (?, ?)",
    );

    const insertMany = this.db.raw.transaction((noteRows: typeof notes) => {
      for (const note of noteRows) {
        const text = `${note.path} ${note.content}`;
        const trigrams = this.extractTrigrams(text);
        for (const tri of trigrams) {
          insertStmt.run(note.id, tri);
        }
      }
    });

    insertMany(notes);
  }

  buildIndexForNote(noteId: number): void {
    this.db.raw.prepare("DELETE FROM trigrams WHERE note_id = ?").run(noteId);
    const note = this.db.getNoteById(noteId);
    if (!note) return;

    const text = `${note.path} ${note.content}`;
    const trigrams = this.extractTrigrams(text);
    const insertStmt = this.db.raw.prepare(
      "INSERT INTO trigrams (note_id, trigram) VALUES (?, ?)",
    );
    for (const tri of trigrams) {
      insertStmt.run(noteId, tri);
    }
  }

  search(query: string, limit: number = 50): TrigramResult[] {
    const queryTrigrams = this.extractTrigrams(query);
    if (queryTrigrams.length === 0) return [];

    const placeholders = queryTrigrams.map(() => "?").join(",");
    const normalizedQuery = query.toLowerCase();
    const stmt = this.db.raw.prepare(`
      SELECT
        t.note_id as noteId,
        n.path,
        CAST(COUNT(DISTINCT t.trigram) AS REAL) / ? as score,
        CASE WHEN lower(n.path) LIKE ? THEN 1 ELSE 0 END as path_match
      FROM trigrams t
      JOIN notes n ON n.id = t.note_id
      WHERE t.trigram IN (${placeholders})
      GROUP BY t.note_id
      HAVING score > 0.1
      ORDER BY path_match DESC, score DESC
      LIMIT ?
    `);

    const rows = stmt.all(
      queryTrigrams.length,
      `%${normalizedQuery}%`,
      ...queryTrigrams,
      limit,
    ) as Array<{ noteId: number; path: string; score: number; path_match: number }>;

    return rows.map(({ noteId, path, score }) => ({ noteId, path, score }));
  }
}
