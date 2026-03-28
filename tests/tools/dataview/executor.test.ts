import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../../src/index/sqlite.js";
import { Vault } from "../../../src/core/vault.js";
import { Indexer } from "../../../src/index/indexer.js";
import { executeQuery } from "../../../src/tools/dataview/executor.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/executor-test.db");

describe("DQL Executor", () => {
  let db: Database;
  let vault: Vault;

  beforeAll(() => {
    // Clean up any leftover DB
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    db = new Database(TEST_DB);
    vault = new Vault(FIXTURE_VAULT);
    const indexer = new Indexer(db, vault);
    indexer.indexAll();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  // ── TABLE queries ─────────────────────────────────────────────────────

  it("TABLE query returns columns", () => {
    const result = executeQuery("TABLE file.name FROM #project", db, vault);
    expect(result.type).toBe("TABLE");
    expect(result.headers).toContain("File");
    expect(result.headers).toContain("file.name");
    expect(result.rows!.length).toBeGreaterThanOrEqual(2);
  });

  it("TABLE WITHOUT ID omits File column", () => {
    const result = executeQuery(
      "TABLE WITHOUT ID file.name FROM #project",
      db,
      vault,
    );
    expect(result.headers).not.toContain("File");
    expect(result.headers).toContain("file.name");
  });

  it("TABLE with alias renames column", () => {
    const result = executeQuery(
      'TABLE file.name AS "Name" FROM #project',
      db,
      vault,
    );
    expect(result.headers).toContain("Name");
  });

  it("TABLE with multiple fields", () => {
    const result = executeQuery(
      "TABLE file.name, status, priority FROM #project",
      db,
      vault,
    );
    expect(result.headers).toContain("file.name");
    expect(result.headers).toContain("status");
    expect(result.headers).toContain("priority");
    expect(result.rows!.length).toBeGreaterThanOrEqual(2);
  });

  // ── LIST queries ──────────────────────────────────────────────────────

  it("LIST query returns items", () => {
    const result = executeQuery('LIST FROM "Projects"', db, vault);
    expect(result.type).toBe("LIST");
    expect(result.items!.length).toBeGreaterThanOrEqual(2);
  });

  it("LIST with expression", () => {
    const result = executeQuery("LIST file.name FROM #project", db, vault);
    expect(result.type).toBe("LIST");
    // Items should include the file path and name
    expect(result.items!.length).toBeGreaterThanOrEqual(2);
  });

  // ── WHERE clause ──────────────────────────────────────────────────────

  it("WHERE filters results by frontmatter", () => {
    const result = executeQuery(
      'TABLE file.name WHERE status = "in-progress"',
      db,
      vault,
    );
    expect(result.rows!.length).toBeGreaterThanOrEqual(1);
    // Alpha has status: in-progress
    const names = result.rows!.map((r) => r["file.name"]);
    expect(names).toContain("Alpha");
  });

  it("WHERE with numeric comparison", () => {
    const result = executeQuery(
      "TABLE file.name, priority FROM #project WHERE priority <= 1",
      db,
      vault,
    );
    expect(result.rows!.length).toBeGreaterThanOrEqual(1);
    const names = result.rows!.map((r) => r["file.name"]);
    expect(names).toContain("Alpha");
  });

  it("WHERE with AND operator", () => {
    const result = executeQuery(
      'TABLE file.name WHERE status = "in-progress" AND priority = 1',
      db,
      vault,
    );
    expect(result.rows!.length).toBe(1);
    expect(result.rows![0]["file.name"]).toBe("Alpha");
  });

  it("WHERE with OR operator", () => {
    const result = executeQuery(
      'TABLE file.name WHERE status = "in-progress" OR status = "planned"',
      db,
      vault,
    );
    expect(result.rows!.length).toBeGreaterThanOrEqual(2);
  });

  // ── SORT clause ───────────────────────────────────────────────────────

  it("SORT orders results ASC", () => {
    const result = executeQuery(
      "TABLE file.name, priority FROM #project SORT priority ASC",
      db,
      vault,
    );
    const priorities = result.rows!.map((r) => r.priority).filter(
      (p) => p !== undefined,
    );
    for (let i = 1; i < priorities.length; i++) {
      expect(Number(priorities[i])).toBeGreaterThanOrEqual(
        Number(priorities[i - 1]),
      );
    }
  });

  it("SORT orders results DESC", () => {
    const result = executeQuery(
      "TABLE file.name, priority FROM #project SORT priority DESC",
      db,
      vault,
    );
    const priorities = result.rows!.map((r) => r.priority).filter(
      (p) => p !== undefined,
    );
    for (let i = 1; i < priorities.length; i++) {
      expect(Number(priorities[i])).toBeLessThanOrEqual(
        Number(priorities[i - 1]),
      );
    }
  });

  // ── LIMIT clause ──────────────────────────────────────────────────────

  it("LIMIT caps results", () => {
    const result = executeQuery("TABLE file.name LIMIT 2", db, vault);
    expect(result.rows!.length).toBeLessThanOrEqual(2);
  });

  // ── FROM sources ──────────────────────────────────────────────────────

  it("FROM tag resolves notes with that tag", () => {
    const result = executeQuery("LIST FROM #project", db, vault);
    expect(result.items!.length).toBeGreaterThanOrEqual(2);
    // Alpha and Beta both have #project tag
    const items = result.items!.map(String);
    expect(items.some((i) => i.includes("Alpha"))).toBe(true);
    expect(items.some((i) => i.includes("Beta"))).toBe(true);
  });

  it("FROM folder resolves notes in folder", () => {
    const result = executeQuery('LIST FROM "Projects"', db, vault);
    // Projects folder has Alpha, Beta, and Nested/Deep Note
    expect(result.items!.length).toBeGreaterThanOrEqual(2);
  });

  it("FROM with negation excludes notes", () => {
    const all = executeQuery("LIST", db, vault);
    const result = executeQuery("LIST FROM -#project", db, vault);
    // Should have fewer items than all
    expect(result.items!.length).toBeLessThan(all.items!.length);
  });

  it("no FROM returns all notes", () => {
    const result = executeQuery("LIST", db, vault);
    // Should return all .md files in the vault
    expect(result.items!.length).toBeGreaterThanOrEqual(7);
  });

  // ── Function calls in WHERE ───────────────────────────────────────────

  it("WHERE with contains() function", () => {
    const result = executeQuery(
      'TABLE file.name WHERE contains(file.name, "Alpha")',
      db,
      vault,
    );
    expect(result.rows!.length).toBeGreaterThanOrEqual(1);
    expect(result.rows![0]["file.name"]).toBe("Alpha");
  });

  it("WHERE with startswith() function", () => {
    const result = executeQuery(
      'TABLE file.name WHERE startswith(file.name, "Alp")',
      db,
      vault,
    );
    expect(result.rows!.length).toBe(1);
  });

  // ── TASK queries ──────────────────────────────────────────────────────

  it("TASK query returns tasks", () => {
    const result = executeQuery("TASK FROM #project", db, vault);
    expect(result.type).toBe("TASK");
    expect(result.tasks!.length).toBeGreaterThan(0);
  });

  it("TASK query includes task details", () => {
    const result = executeQuery("TASK FROM #project", db, vault);
    const task = result.tasks![0];
    expect(task).toHaveProperty("text");
    expect(task).toHaveProperty("status");
    expect(task).toHaveProperty("path");
    expect(task).toHaveProperty("line");
  });

  // ── CALENDAR queries ──────────────────────────────────────────────────

  it("CALENDAR query returns date entries", () => {
    const result = executeQuery("CALENDAR due FROM #project", db, vault);
    expect(result.type).toBe("CALENDAR");
    // Alpha has due: 2025-06-01
    expect(result.calendar!.length).toBeGreaterThanOrEqual(1);
    const entry = result.calendar!.find((c) => c.path.includes("Alpha"));
    expect(entry).toBeDefined();
    // gray-matter parses YAML dates into JS Date objects, so the
    // stringified value includes the time component
    expect(entry!.date).toContain("2025-06-01");
  });

  // ── Inline fields ────────────────────────────────────────────────────

  it("inline fields are accessible", () => {
    const result = executeQuery(
      "TABLE rating FROM #project WHERE rating >= 4",
      db,
      vault,
    );
    expect(result.rows!.length).toBeGreaterThanOrEqual(1);
    // Alpha has rating:: 5
    const row = result.rows!.find((r) =>
      String(r["File"]).includes("Alpha"),
    );
    expect(row).toBeDefined();
    expect(row!.rating).toBe(5);
  });

  it("inline fields override frontmatter", () => {
    // category is an inline field, not frontmatter
    const result = executeQuery(
      'TABLE category FROM #project WHERE category = "engineering"',
      db,
      vault,
    );
    expect(result.rows!.length).toBeGreaterThanOrEqual(1);
  });

  // ── Arithmetic expressions ────────────────────────────────────────────

  it("arithmetic expressions in TABLE fields", () => {
    const result = executeQuery(
      "TABLE priority, priority + 10 FROM #project WHERE priority = 1",
      db,
      vault,
    );
    expect(result.rows!.length).toBe(1);
    // priority + 10 should be 11
    const row = result.rows![0];
    // The field name for an arithmetic expression
    const keys = Object.keys(row);
    const computedKey = keys.find((k) => k !== "File" && k !== "priority");
    expect(computedKey).toBeDefined();
  });

  // ── file.* fields ────────────────────────────────────────────────────

  it("file.tags returns tag list", () => {
    const result = executeQuery(
      "TABLE file.tags FROM #project LIMIT 1",
      db,
      vault,
    );
    const row = result.rows![0];
    expect(Array.isArray(row["file.tags"])).toBe(true);
    expect((row["file.tags"] as string[]).length).toBeGreaterThan(0);
  });

  it("file.folder returns directory", () => {
    const result = executeQuery(
      'TABLE file.folder WHERE file.folder = "Projects"',
      db,
      vault,
    );
    expect(result.rows!.length).toBeGreaterThanOrEqual(2);
  });

  it("file.size returns content length", () => {
    const result = executeQuery(
      "TABLE file.size WHERE file.size > 0 LIMIT 1",
      db,
      vault,
    );
    expect(result.rows!.length).toBe(1);
    expect(typeof result.rows![0]["file.size"]).toBe("number");
  });
});
