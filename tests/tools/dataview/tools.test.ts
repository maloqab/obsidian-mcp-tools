import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../../src/index/sqlite.js";
import { Vault } from "../../../src/core/vault.js";
import { Indexer } from "../../../src/index/indexer.js";
import { dataviewQuery, dataviewFields, dataviewEval } from "../../../src/tools/dataview/tools.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/dv-tools-test.db");

describe("Dataview MCP tools", () => {
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

  describe("dataviewQuery", () => {
    it("executes a TABLE query", () => {
      const result = dataviewQuery(db, vault, { query: "TABLE file.name FROM #project" });
      expect(result.type).toBe("TABLE");
      expect(result.rows!.length).toBeGreaterThanOrEqual(2);
    });

    it("executes a LIST query", () => {
      const result = dataviewQuery(db, vault, { query: 'LIST FROM "Projects"' });
      expect(result.type).toBe("LIST");
      expect(result.items!.length).toBeGreaterThan(0);
    });

    it("executes a TASK query", () => {
      const result = dataviewQuery(db, vault, { query: "TASK FROM #project" });
      expect(result.type).toBe("TASK");
      expect(result.tasks!.length).toBeGreaterThan(0);
    });
  });

  describe("dataviewFields", () => {
    it("lists all inline fields", () => {
      const fields = dataviewFields(db);
      expect(fields.length).toBeGreaterThan(0);
      const rating = fields.find(f => f.key === "rating");
      expect(rating).toBeDefined();
      expect(rating!.count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("dataviewEval", () => {
    it("evaluates an expression against a note", () => {
      const result = dataviewEval(db, vault, {
        expression: "file.name",
        notePath: "Projects/Alpha.md",
      });
      expect(result).toContain("Alpha");
    });

    it("evaluates a function call", () => {
      const result = dataviewEval(db, vault, {
        expression: 'contains(file.name, "Alpha")',
        notePath: "Projects/Alpha.md",
      });
      expect(result).toBe(true);
    });
  });
});
