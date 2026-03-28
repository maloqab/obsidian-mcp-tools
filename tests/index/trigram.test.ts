import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { TrigramIndex } from "../../src/index/trigram.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/trigram-test.db");

describe("TrigramIndex", () => {
  let db: Database;
  let trigram: TrigramIndex;

  beforeAll(() => {
    db = new Database(TEST_DB);
    const vault = new Vault(FIXTURE_VAULT);
    const indexer = new Indexer(db, vault);
    indexer.indexAll();
    trigram = new TrigramIndex(db);
    trigram.buildIndex();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("finds exact matches", () => {
    const results = trigram.search("Alpha");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("Alpha");
  });

  it("finds fuzzy matches with typos", () => {
    const results = trigram.search("Alphaa");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns similarity scores between 0 and 1", () => {
    const results = trigram.search("project");
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("returns empty array for completely unrelated query", () => {
    const results = trigram.search("xyzxyzxyz");
    expect(results).toEqual([]);
  });
});
