import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { FtsIndex } from "../../src/index/fts.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/fts-test.db");

describe("FtsIndex", () => {
  let db: Database;
  let fts: FtsIndex;

  beforeAll(() => {
    db = new Database(TEST_DB);
    const vault = new Vault(FIXTURE_VAULT);
    const indexer = new Indexer(db, vault);
    indexer.indexAll();
    fts = new FtsIndex(db);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("finds notes by keyword", () => {
    const results = fts.search("Alpha");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("Alpha");
  });

  it("finds notes by content keyword", () => {
    const results = fts.search("repository");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns BM25 scores", () => {
    const results = fts.search("project");
    expect(results.every((r) => typeof r.score === "number")).toBe(true);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("returns empty array for no matches", () => {
    const results = fts.search("zzzznonexistent");
    expect(results).toEqual([]);
  });

  it("supports phrase search", () => {
    const results = fts.search('"entry point"');
    expect(results.length).toBeGreaterThan(0);
  });
});
