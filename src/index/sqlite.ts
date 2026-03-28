import BetterSqlite3 from "better-sqlite3";

export interface NoteRow {
  id: number;
  path: string;
  content: string;
  frontmatter_json: string;
  created: string;
  modified: string;
  checksum: string;
}

export interface UpsertNoteParams {
  path: string;
  content: string;
  frontmatterJson: string;
  checksum: string;
}

export interface InsertTagParams {
  noteId: number;
  tag: string;
  source: "frontmatter" | "inline";
}

export interface InsertLinkParams {
  sourceNoteId: number;
  targetPath: string;
  linkType: "wiki" | "markdown" | "embed";
  lineNumber?: number;
}

export interface InsertInlineFieldParams {
  noteId: number;
  key: string;
  value: string | null;
  type: "string" | "number" | "date" | "list" | "boolean";
  lineNumber?: number;
}

export class Database {
  readonly raw: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.raw = new BetterSqlite3(dbPath);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.createSchema();
  }

  private createSchema(): void {
    this.raw.exec(`
      -- Core note storage
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        frontmatter_json TEXT NOT NULL DEFAULT '{}',
        created TEXT NOT NULL DEFAULT (datetime('now')),
        modified TEXT NOT NULL DEFAULT (datetime('now')),
        checksum TEXT NOT NULL DEFAULT ''
      );

      -- FTS5 virtual table with content sync triggers
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
        path, content,
        content='notes', content_rowid='id',
        tokenize='porter unicode61'
      );

      -- Triggers to keep FTS in sync with notes table
      CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
        INSERT INTO fts_index(rowid, path, content) VALUES (new.id, new.path, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
        INSERT INTO fts_index(fts_index, rowid, path, content) VALUES ('delete', old.id, old.path, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO fts_index(fts_index, rowid, path, content) VALUES ('delete', old.id, old.path, old.content);
        INSERT INTO fts_index(rowid, path, content) VALUES (new.id, new.path, new.content);
      END;

      -- Tags table
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('frontmatter', 'inline'))
      );
      CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
      CREATE INDEX IF NOT EXISTS idx_tags_note_id ON tags(note_id);

      -- Links table
      CREATE TABLE IF NOT EXISTS links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        target_path TEXT NOT NULL,
        link_type TEXT NOT NULL CHECK(link_type IN ('wiki', 'markdown', 'embed')),
        line_number INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_note_id);
      CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);

      -- Inline fields table
      CREATE TABLE IF NOT EXISTS inline_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        type TEXT NOT NULL CHECK(type IN ('string', 'number', 'date', 'list', 'boolean')),
        line_number INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_inline_fields_key ON inline_fields(key);
      CREATE INDEX IF NOT EXISTS idx_inline_fields_note_id ON inline_fields(note_id);

      -- Embeddings table
      CREATE TABLE IF NOT EXISTS embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        vector BLOB NOT NULL,
        model_name TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_embeddings_note_id ON embeddings(note_id);

      -- Trigrams table
      CREATE TABLE IF NOT EXISTS trigrams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        trigram TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trigrams_trigram ON trigrams(trigram);
      CREATE INDEX IF NOT EXISTS idx_trigrams_note_id ON trigrams(note_id);
    `);
  }

  upsertNote(params: UpsertNoteParams): void {
    this.raw
      .prepare(
        `INSERT INTO notes (path, content, frontmatter_json, checksum)
         VALUES (@path, @content, @frontmatterJson, @checksum)
         ON CONFLICT(path) DO UPDATE SET
           content = excluded.content,
           frontmatter_json = excluded.frontmatter_json,
           checksum = excluded.checksum,
           modified = datetime('now')`
      )
      .run(params);
  }

  getNoteByPath(path: string): NoteRow | null {
    const row = this.raw
      .prepare(`SELECT * FROM notes WHERE path = ?`)
      .get(path) as NoteRow | undefined;
    return row ?? null;
  }

  getNoteById(id: number): NoteRow | null {
    const row = this.raw
      .prepare(`SELECT * FROM notes WHERE id = ?`)
      .get(id) as NoteRow | undefined;
    return row ?? null;
  }

  getAllNotes(): NoteRow[] {
    return this.raw.prepare(`SELECT * FROM notes ORDER BY path`).all() as NoteRow[];
  }

  deleteNoteByPath(path: string): void {
    this.raw.prepare(`DELETE FROM notes WHERE path = ?`).run(path);
  }

  getChecksumByPath(path: string): string | null {
    const row = this.raw
      .prepare(`SELECT checksum FROM notes WHERE path = ?`)
      .get(path) as { checksum: string } | undefined;
    return row?.checksum ?? null;
  }

  insertTag(noteId: number, tag: string, source: "frontmatter" | "inline"): void {
    this.raw
      .prepare(`INSERT INTO tags (note_id, tag, source) VALUES (?, ?, ?)`)
      .run(noteId, tag, source);
  }

  insertLink(
    sourceNoteId: number,
    targetPath: string,
    linkType: "wiki" | "markdown" | "embed",
    lineNumber?: number
  ): void {
    this.raw
      .prepare(
        `INSERT INTO links (source_note_id, target_path, link_type, line_number)
         VALUES (?, ?, ?, ?)`
      )
      .run(sourceNoteId, targetPath, linkType, lineNumber ?? null);
  }

  insertInlineField(
    noteId: number,
    key: string,
    value: string | null,
    type: "string" | "number" | "date" | "list" | "boolean",
    lineNumber?: number
  ): void {
    this.raw
      .prepare(
        `INSERT INTO inline_fields (note_id, key, value, type, line_number)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(noteId, key, value, type, lineNumber ?? null);
  }

  clearNoteMetadata(noteId: number): void {
    this.raw.prepare(`DELETE FROM tags WHERE note_id = ?`).run(noteId);
    this.raw.prepare(`DELETE FROM links WHERE source_note_id = ?`).run(noteId);
    this.raw.prepare(`DELETE FROM inline_fields WHERE note_id = ?`).run(noteId);
    this.raw.prepare(`DELETE FROM embeddings WHERE note_id = ?`).run(noteId);
    this.raw.prepare(`DELETE FROM trigrams WHERE note_id = ?`).run(noteId);
  }

  close(): void {
    this.raw.close();
  }
}
