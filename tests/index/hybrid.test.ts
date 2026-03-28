import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { FtsIndex } from "../../src/index/fts.js";
import { TrigramIndex } from "../../src/index/trigram.js";
import { HybridSearch } from "../../src/index/hybrid.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/hybrid-test.db");

describe("HybridSearch", () => {
  let db: Database;
  let hybrid: HybridSearch;

  beforeAll(() => {
    db = new Database(TEST_DB);
    const vault = new Vault(FIXTURE_VAULT);
    const indexer = new Indexer(db, vault);
    indexer.indexAll();
    const fts = new FtsIndex(db);
    const trigram = new TrigramIndex(db);
    trigram.buildIndex();
    // Skip vector for tests -- hybrid handles null gracefully
    hybrid = new HybridSearch(fts, trigram, null);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns ranked results combining FTS and trigram", async () => {
    const results = await hybrid.search("project Alpha");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("Alpha");
  });

  it("handles fuzzy queries via trigram fallback", async () => {
    const results = await hybrid.search("Alphaa");
    expect(results.length).toBeGreaterThan(0);
  });

  it("supports mode override to fts-only", async () => {
    const results = await hybrid.search("project", { mode: "fts" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("supports custom weights", async () => {
    const results = await hybrid.search("project", {
      weights: { fts: 1.0, trigram: 0, vector: 0 },
    });
    expect(results.length).toBeGreaterThan(0);
  });

  it("deduplicates results from multiple engines", async () => {
    const results = await hybrid.search("Alpha");
    const paths = results.map((r) => r.path);
    const uniquePaths = [...new Set(paths)];
    expect(paths.length).toBe(uniquePaths.length);
  });
});
