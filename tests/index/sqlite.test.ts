import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import fs from "fs";
import path from "path";

const TEST_DB_PATH = path.resolve("tests/fixtures/test.db");

describe("Database", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    if (fs.existsSync(TEST_DB_PATH + "-journal")) fs.unlinkSync(TEST_DB_PATH + "-journal");
  });

  it("creates all required tables", () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("notes");
    expect(names).toContain("tags");
    expect(names).toContain("links");
    expect(names).toContain("inline_fields");
    expect(names).toContain("embeddings");
    expect(names).toContain("trigrams");
  });

  it("creates FTS5 virtual table", () => {
    const tables = db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fts_index'")
      .all();
    expect(tables).toHaveLength(1);
  });

  it("inserts and retrieves a note", () => {
    db.upsertNote({
      path: "test.md",
      content: "# Test",
      frontmatterJson: "{}",
      checksum: "abc123",
    });
    const note = db.getNoteByPath("test.md");
    expect(note).not.toBeNull();
    expect(note!.content).toBe("# Test");
    expect(note!.checksum).toBe("abc123");
  });

  it("upserts a note (update on conflict)", () => {
    db.upsertNote({ path: "test.md", content: "v1", frontmatterJson: "{}", checksum: "aaa" });
    db.upsertNote({ path: "test.md", content: "v2", frontmatterJson: "{}", checksum: "bbb" });
    const note = db.getNoteByPath("test.md");
    expect(note!.content).toBe("v2");
    expect(note!.checksum).toBe("bbb");
  });

  it("deletes a note and its related data", () => {
    db.upsertNote({ path: "test.md", content: "# Test", frontmatterJson: "{}", checksum: "abc" });
    const note = db.getNoteByPath("test.md");
    db.insertTag(note!.id, "test-tag", "frontmatter");
    db.insertLink(note!.id, "other.md", "wiki");
    db.deleteNoteByPath("test.md");
    expect(db.getNoteByPath("test.md")).toBeNull();
  });

  it("returns null for getNoteByPath when note does not exist", () => {
    expect(db.getNoteByPath("nonexistent.md")).toBeNull();
  });

  it("returns null for getNoteById when note does not exist", () => {
    expect(db.getNoteById(9999)).toBeNull();
  });

  it("returns all notes via getAllNotes", () => {
    db.upsertNote({ path: "a.md", content: "A", frontmatterJson: "{}", checksum: "1" });
    db.upsertNote({ path: "b.md", content: "B", frontmatterJson: "{}", checksum: "2" });
    const all = db.getAllNotes();
    expect(all).toHaveLength(2);
    expect(all.map((n) => n.path)).toEqual(["a.md", "b.md"]);
  });

  it("returns checksum by path", () => {
    db.upsertNote({ path: "test.md", content: "# Test", frontmatterJson: "{}", checksum: "xyz" });
    expect(db.getChecksumByPath("test.md")).toBe("xyz");
  });

  it("returns null checksum for unknown path", () => {
    expect(db.getChecksumByPath("unknown.md")).toBeNull();
  });

  it("inserts tags and they cascade-delete with note", () => {
    db.upsertNote({ path: "test.md", content: "# Test", frontmatterJson: "{}", checksum: "abc" });
    const note = db.getNoteByPath("test.md")!;
    db.insertTag(note.id, "tag1", "frontmatter");
    db.insertTag(note.id, "tag2", "inline");
    const tags = db.raw
      .prepare("SELECT * FROM tags WHERE note_id = ?")
      .all(note.id) as { tag: string; source: string }[];
    expect(tags).toHaveLength(2);
    db.deleteNoteByPath("test.md");
    const tagsAfter = db.raw.prepare("SELECT * FROM tags WHERE note_id = ?").all(note.id);
    expect(tagsAfter).toHaveLength(0);
  });

  it("inserts links and they cascade-delete with note", () => {
    db.upsertNote({ path: "test.md", content: "# Test", frontmatterJson: "{}", checksum: "abc" });
    const note = db.getNoteByPath("test.md")!;
    db.insertLink(note.id, "other.md", "wiki", 5);
    db.insertLink(note.id, "embed.png", "embed");
    const links = db.raw
      .prepare("SELECT * FROM links WHERE source_note_id = ?")
      .all(note.id) as { target_path: string; link_type: string }[];
    expect(links).toHaveLength(2);
    db.deleteNoteByPath("test.md");
    const linksAfter = db.raw
      .prepare("SELECT * FROM links WHERE source_note_id = ?")
      .all(note.id);
    expect(linksAfter).toHaveLength(0);
  });

  it("inserts inline fields", () => {
    db.upsertNote({ path: "test.md", content: "# Test", frontmatterJson: "{}", checksum: "abc" });
    const note = db.getNoteByPath("test.md")!;
    db.insertInlineField(note.id, "rating", "5", "number", 3);
    db.insertInlineField(note.id, "tags", null, "list");
    const fields = db.raw
      .prepare("SELECT * FROM inline_fields WHERE note_id = ?")
      .all(note.id) as { key: string; value: string | null; type: string }[];
    expect(fields).toHaveLength(2);
    expect(fields[0].key).toBe("rating");
    expect(fields[1].value).toBeNull();
  });

  it("clearNoteMetadata removes related rows but keeps note", () => {
    db.upsertNote({ path: "test.md", content: "# Test", frontmatterJson: "{}", checksum: "abc" });
    const note = db.getNoteByPath("test.md")!;
    db.insertTag(note.id, "tag1", "frontmatter");
    db.insertLink(note.id, "other.md", "wiki");
    db.insertInlineField(note.id, "key", "val", "string");
    db.clearNoteMetadata(note.id);
    const tags = db.raw.prepare("SELECT * FROM tags WHERE note_id = ?").all(note.id);
    const links = db.raw.prepare("SELECT * FROM links WHERE source_note_id = ?").all(note.id);
    const fields = db.raw.prepare("SELECT * FROM inline_fields WHERE note_id = ?").all(note.id);
    expect(tags).toHaveLength(0);
    expect(links).toHaveLength(0);
    expect(fields).toHaveLength(0);
    expect(db.getNoteByPath("test.md")).not.toBeNull();
  });

  it("getNoteById returns the correct note", () => {
    db.upsertNote({ path: "test.md", content: "# Test", frontmatterJson: "{}", checksum: "abc" });
    const note = db.getNoteByPath("test.md")!;
    const byId = db.getNoteById(note.id);
    expect(byId).not.toBeNull();
    expect(byId!.path).toBe("test.md");
  });
});
