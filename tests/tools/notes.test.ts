import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { readNote, createNote, editNote, deleteNote, moveNote, splitNote, mergeNotes, duplicateNote } from "../../src/tools/notes.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const WORK_VAULT = path.resolve("tests/fixtures/work-vault-notes");
const TEST_DB = path.resolve("tests/fixtures/notes-test.db");

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

describe("note tools", () => {
  let db: Database;
  let vault: Vault;
  let indexer: Indexer;

  beforeEach(() => {
    copyDir(FIXTURE_VAULT, WORK_VAULT);
    db = new Database(TEST_DB);
    vault = new Vault(WORK_VAULT);
    indexer = new Indexer(db, vault);
    indexer.indexAll();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(WORK_VAULT, { recursive: true, force: true });
  });

  describe("readNote", () => {
    it("reads a note's full content", () => {
      const result = readNote(vault, db, { path: "Welcome.md" });
      expect(result.content).toContain("Welcome to the Vault");
      expect(result.frontmatter.title).toBe("Welcome to the Vault");
    });

    it("reads a specific section by heading", () => {
      const result = readNote(vault, db, { path: "Projects/Alpha.md", section: "Tasks" });
      expect(result.content).toContain("Complete the design");
      expect(result.content).not.toContain("# Project Alpha");
    });

    it("throws for nonexistent note", () => {
      expect(() => readNote(vault, db, { path: "Nope.md" })).toThrow();
    });
  });

  describe("createNote", () => {
    it("creates a new note", () => {
      createNote(vault, indexer, { path: "New Note.md", content: "# New Note\n\nHello world" });
      expect(vault.exists("New Note.md")).toBe(true);
      expect(vault.readFile("New Note.md")).toContain("Hello world");
    });

    it("creates a note with frontmatter", () => {
      createNote(vault, indexer, {
        path: "With FM.md",
        content: "Body text",
        frontmatter: { title: "With FM", tags: ["test"] },
      });
      const content = vault.readFile("With FM.md");
      expect(content).toContain("title: With FM");
      expect(content).toContain("Body text");
    });

    it("throws if note already exists", () => {
      expect(() => createNote(vault, indexer, { path: "Welcome.md", content: "dupe" })).toThrow();
    });
  });

  describe("editNote", () => {
    it("replaces full content", () => {
      editNote(vault, indexer, { path: "Welcome.md", content: "# Updated\n\nNew content" });
      expect(vault.readFile("Welcome.md")).toContain("New content");
    });

    it("patches a section by heading", () => {
      editNote(vault, indexer, {
        path: "Projects/Alpha.md",
        section: "Tasks",
        content: "- [ ] Only this task now",
      });
      const content = vault.readFile("Projects/Alpha.md");
      expect(content).toContain("Only this task now");
      expect(content).toContain("# Project Alpha");
    });
  });

  describe("deleteNote", () => {
    it("deletes a note permanently", () => {
      deleteNote(vault, indexer, db, { path: "Orphan.md", trash: false });
      expect(vault.exists("Orphan.md")).toBe(false);
    });

    it("moves note to trash when trash=true", () => {
      deleteNote(vault, indexer, db, { path: "Orphan.md", trash: true, trashFolder: ".trash" });
      expect(vault.exists("Orphan.md")).toBe(false);
      expect(vault.exists(".trash/Orphan.md")).toBe(true);
    });
  });

  describe("moveNote", () => {
    it("moves a note and updates backlinks", () => {
      moveNote(vault, indexer, db, {
        path: "Projects/Alpha.md",
        newPath: "Archive/Alpha.md",
        updateLinks: true,
      });
      expect(vault.exists("Archive/Alpha.md")).toBe(true);
      expect(vault.exists("Projects/Alpha.md")).toBe(false);
      const betaContent = vault.readFile("Projects/Beta.md");
      expect(betaContent).toContain("[[Archive/Alpha]]");
    });

    it("moves without updating links when disabled", () => {
      moveNote(vault, indexer, db, {
        path: "Projects/Alpha.md",
        newPath: "Archive/Alpha.md",
        updateLinks: false,
      });
      const betaContent = vault.readFile("Projects/Beta.md");
      expect(betaContent).toContain("[[Projects/Alpha]]");
    });
  });

  describe("splitNote", () => {
    it("splits a note by headings", () => {
      const created = splitNote(vault, indexer, {
        path: "Projects/Alpha.md",
        byHeadingLevel: 2,
      });
      expect(created.length).toBeGreaterThan(1);
      expect(created.some((p) => p.includes("Tasks"))).toBe(true);
      expect(created.some((p) => p.includes("Notes"))).toBe(true);
    });
  });

  describe("mergeNotes", () => {
    it("merges multiple notes into one", () => {
      mergeNotes(vault, indexer, {
        paths: ["Projects/Alpha.md", "Projects/Beta.md"],
        targetPath: "Projects/Merged.md",
        deleteOriginals: false,
      });
      expect(vault.exists("Projects/Merged.md")).toBe(true);
      const content = vault.readFile("Projects/Merged.md");
      expect(content).toContain("Project Alpha");
      expect(content).toContain("Project Beta");
    });
  });

  describe("duplicateNote", () => {
    it("copies a note with a new name", () => {
      duplicateNote(vault, indexer, {
        path: "Welcome.md",
        newPath: "Welcome Copy.md",
      });
      expect(vault.exists("Welcome Copy.md")).toBe(true);
      expect(vault.exists("Welcome.md")).toBe(true);
      expect(vault.readFile("Welcome Copy.md")).toContain("Welcome to the Vault");
    });
  });
});
