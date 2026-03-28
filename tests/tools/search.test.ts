import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { FtsIndex } from "../../src/index/fts.js";
import { TrigramIndex } from "../../src/index/trigram.js";
import { HybridSearch } from "../../src/index/hybrid.js";
import { searchVault, searchReplace, searchByFrontmatter } from "../../src/tools/search.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const WORK_VAULT = path.resolve("tests/fixtures/work-vault-search");
const TEST_DB = path.resolve("tests/fixtures/search-tools-test.db");

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

describe("search tools", () => {
  let db: Database;
  let vault: Vault;
  let hybrid: HybridSearch;

  beforeEach(() => {
    copyDir(FIXTURE_VAULT, WORK_VAULT);
    db = new Database(TEST_DB);
    vault = new Vault(WORK_VAULT);
    const indexer = new Indexer(db, vault);
    indexer.indexAll();
    const fts = new FtsIndex(db);
    const trigram = new TrigramIndex(db);
    trigram.buildIndex();
    hybrid = new HybridSearch(fts, trigram, null);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(WORK_VAULT, { recursive: true, force: true });
  });

  describe("searchVault", () => {
    it("finds notes by keyword", async () => {
      const results = await searchVault(hybrid, { query: "Alpha" });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("searchReplace", () => {
    it("previews replacements without applying", () => {
      const results = searchReplace(vault, db, {
        search: "entry point",
        replace: "starting point",
        preview: true,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(vault.readFile("Welcome.md")).toContain("entry point");
    });

    it("applies replacements", () => {
      searchReplace(vault, db, {
        search: "entry point",
        replace: "starting point",
        preview: false,
      });
      expect(vault.readFile("Welcome.md")).toContain("starting point");
    });

    it("supports regex search", () => {
      const results = searchReplace(vault, db, {
        search: "Project \\w+",
        replace: "Project REPLACED",
        regex: true,
        preview: true,
      });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("searchByFrontmatter", () => {
    it("finds notes by frontmatter field", () => {
      const results = searchByFrontmatter(db, { field: "status", value: "in-progress" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].path).toContain("Alpha");
    });
  });
});
