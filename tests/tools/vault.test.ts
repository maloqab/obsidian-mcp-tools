import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { vaultStats, listFiles } from "../../src/tools/vault.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/vault-tools-test.db");

describe("vault tools", () => {
  let db: Database;
  let vault: Vault;

  beforeAll(() => {
    db = new Database(TEST_DB);
    vault = new Vault(FIXTURE_VAULT);
    const indexer = new Indexer(db, vault);
    indexer.indexAll();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe("vaultStats", () => {
    it("returns note count", () => {
      const stats = vaultStats(db, vault);
      expect(stats.noteCount).toBeGreaterThan(5);
    });

    it("returns tag count", () => {
      const stats = vaultStats(db, vault);
      expect(stats.uniqueTagCount).toBeGreaterThan(0);
    });

    it("returns link count", () => {
      const stats = vaultStats(db, vault);
      expect(stats.linkCount).toBeGreaterThan(0);
    });
  });

  describe("listFiles", () => {
    it("lists all files with no filter", () => {
      const files = listFiles(vault, {});
      expect(files.length).toBeGreaterThan(5);
    });

    it("filters by glob pattern", () => {
      const files = listFiles(vault, { glob: "Projects/**/*.md" });
      expect(files.every((f) => f.startsWith("Projects/"))).toBe(true);
    });

    it("filters by extension", () => {
      const files = listFiles(vault, { extension: ".canvas" });
      expect(files.every((f) => f.endsWith(".canvas"))).toBe(true);
    });

    it("limits depth", () => {
      const files = listFiles(vault, { maxDepth: 1 });
      expect(files.every((f) => !f.includes("/") || f.split("/").length <= 2)).toBe(true);
    });
  });
});
