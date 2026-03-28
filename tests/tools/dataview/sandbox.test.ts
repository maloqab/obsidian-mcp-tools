import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../../src/index/sqlite.js";
import { Vault } from "../../../src/core/vault.js";
import { Indexer } from "../../../src/index/indexer.js";
import { createDvApi, executeDvScript } from "../../../src/tools/dataview/sandbox.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/sandbox-test.db");

describe("DQL Sandbox", () => {
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

  it("executes a simple dv.pages query", () => {
    const dvApi = createDvApi(db, vault);
    const result = executeDvScript('return dv.pages("#project").length', dvApi);
    expect(result).toBeGreaterThanOrEqual(2);
  });

  it("dv.pages returns page objects with file fields", () => {
    const dvApi = createDvApi(db, vault);
    const result = executeDvScript('return dv.pages("#project")[0].file.name', dvApi);
    expect(typeof result).toBe("string");
  });

  it("cannot access filesystem", () => {
    const dvApi = createDvApi(db, vault);
    expect(() => {
      executeDvScript('const fs = require("fs"); return fs.readFileSync("/etc/passwd")', dvApi);
    }).toThrow();
  });

  it("cannot access process", () => {
    const dvApi = createDvApi(db, vault);
    expect(() => {
      executeDvScript('return process.env', dvApi);
    }).toThrow();
  });

  it("times out on infinite loops", () => {
    const dvApi = createDvApi(db, vault);
    expect(() => {
      executeDvScript('while(true) {}', dvApi, 100);
    }).toThrow();
  });
});
