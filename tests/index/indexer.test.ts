import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Indexer } from "../../src/index/indexer.js";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/indexer-test.db");

describe("Indexer", () => {
  let db: Database;
  let vault: Vault;
  let indexer: Indexer;

  beforeEach(() => {
    db = new Database(TEST_DB);
    vault = new Vault(FIXTURE_VAULT);
    indexer = new Indexer(db, vault);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("indexes all markdown files in vault", () => {
    indexer.indexAll();
    const notes = db.getAllNotes();
    expect(notes.length).toBeGreaterThan(5);
  });

  it("populates tags table", () => {
    indexer.indexAll();
    const tags = db.raw.prepare("SELECT DISTINCT tag FROM tags").all() as { tag: string }[];
    const tagNames = tags.map((t) => t.tag);
    expect(tagNames).toContain("project");
    expect(tagNames).toContain("active");
  });

  it("populates links table", () => {
    indexer.indexAll();
    const links = db.raw.prepare("SELECT * FROM links").all() as { target_path: string }[];
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((l) => l.target_path === "Projects/Alpha")).toBe(true);
  });

  it("populates inline_fields table", () => {
    indexer.indexAll();
    const fields = db.raw.prepare("SELECT * FROM inline_fields WHERE key = 'rating'").all() as { value: string }[];
    expect(fields.length).toBeGreaterThan(0);
  });

  it("skips unchanged files on re-index", () => {
    indexer.indexAll();
    const count1 = (db.raw.prepare("SELECT COUNT(*) as c FROM notes").get() as { c: number }).c;
    indexer.indexAll();
    const count2 = (db.raw.prepare("SELECT COUNT(*) as c FROM notes").get() as { c: number }).c;
    expect(count1).toBe(count2);
  });

  it("re-indexes a changed file", () => {
    indexer.indexAll();
    db.raw.prepare("UPDATE notes SET checksum = 'stale' WHERE path = 'Welcome.md'").run();
    indexer.indexAll();
    const updated = db.getNoteByPath("Welcome.md");
    expect(updated!.checksum).not.toBe("stale");
  });
});
