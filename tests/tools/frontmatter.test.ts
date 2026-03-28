import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { getFrontmatter, setFrontmatter, deleteFrontmatter, frontmatterSchema } from "../../src/tools/frontmatter.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const WORK_VAULT = path.resolve("tests/fixtures/work-vault-fm");
const TEST_DB = path.resolve("tests/fixtures/fm-tools-test.db");

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

describe("frontmatter tools", () => {
  let db: Database; let vault: Vault; let indexer: Indexer;

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

  describe("getFrontmatter", () => {
    it("returns all frontmatter", () => {
      const fm = getFrontmatter(vault, { path: "Projects/Alpha.md" });
      expect(fm.title).toBe("Project Alpha");
      expect(fm.status).toBe("in-progress");
      expect(fm.tags).toEqual(["project", "active"]);
    });

    it("returns specific keys", () => {
      const fm = getFrontmatter(vault, { path: "Projects/Alpha.md", keys: ["title", "status"] });
      expect(fm.title).toBe("Project Alpha");
      expect(fm.status).toBe("in-progress");
      expect(fm.tags).toBeUndefined();
    });
  });

  describe("setFrontmatter", () => {
    it("sets new frontmatter keys", () => {
      setFrontmatter(vault, indexer, { path: "Projects/Alpha.md", data: { reviewed: true } });
      const fm = getFrontmatter(vault, { path: "Projects/Alpha.md" });
      expect(fm.reviewed).toBe(true);
      expect(fm.title).toBe("Project Alpha"); // existing preserved
    });

    it("updates existing keys", () => {
      setFrontmatter(vault, indexer, { path: "Projects/Alpha.md", data: { status: "complete" } });
      const fm = getFrontmatter(vault, { path: "Projects/Alpha.md" });
      expect(fm.status).toBe("complete");
    });
  });

  describe("deleteFrontmatter", () => {
    it("removes specific keys", () => {
      deleteFrontmatter(vault, indexer, { path: "Projects/Alpha.md", keys: ["priority", "due"] });
      const fm = getFrontmatter(vault, { path: "Projects/Alpha.md" });
      expect(fm.priority).toBeUndefined();
      expect(fm.due).toBeUndefined();
      expect(fm.title).toBe("Project Alpha"); // others preserved
    });
  });

  describe("frontmatterSchema", () => {
    it("lists all frontmatter keys across vault", () => {
      const schema = frontmatterSchema(db);
      expect(schema.length).toBeGreaterThan(0);
      const titleEntry = schema.find(s => s.key === "title");
      expect(titleEntry).toBeDefined();
      expect(titleEntry!.count).toBeGreaterThan(3);
    });
  });
});
