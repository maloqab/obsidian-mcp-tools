import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { getBacklinks, getOutlinks, getGraph, findPath, getOrphans, getNeighbors } from "../../src/tools/graph.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const TEST_DB = path.resolve("tests/fixtures/graph-test.db");

describe("graph tools", () => {
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

  describe("getBacklinks", () => {
    it("finds notes linking to Projects/Alpha", () => {
      const results = getBacklinks(db, vault, "Projects/Alpha");
      expect(results.length).toBeGreaterThan(0);
      const paths = results.map((r) => r.sourcePath);
      expect(paths).toContain("Welcome.md");
      expect(paths).toContain("Projects/Beta.md");
    });

    it("includes line context", () => {
      const results = getBacklinks(db, vault, "Projects/Alpha");
      expect(results.every((r) => r.line !== undefined)).toBe(true);
    });
  });

  describe("getOutlinks", () => {
    it("finds links from Welcome.md", () => {
      const results = getOutlinks(db, vault, "Welcome.md");
      expect(results.length).toBeGreaterThan(0);
      const targets = results.map((r) => r.targetPath);
      expect(targets).toContain("Projects/Alpha");
    });
  });

  describe("getGraph", () => {
    it("returns nodes and edges", () => {
      const graph = getGraph(db, vault);
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it("filters by folder", () => {
      const graph = getGraph(db, vault, { folder: "Projects" });
      expect(graph.nodes.every((n) => n.path.startsWith("Projects/"))).toBe(true);
    });
  });

  describe("findPath", () => {
    it("finds a path between two connected notes", () => {
      const chain = findPath(db, vault, "Welcome.md", "Projects/Beta.md");
      expect(chain).not.toBeNull();
      expect(chain!.length).toBeGreaterThanOrEqual(2);
      expect(chain![0]).toBe("Welcome.md");
      expect(chain![chain!.length - 1]).toBe("Projects/Beta.md");
    });

    it("returns null for disconnected notes", () => {
      const chain = findPath(db, vault, "Welcome.md", "Orphan.md");
      expect(chain).toBeNull();
    });
  });

  describe("getOrphans", () => {
    it("finds orphan notes", () => {
      const orphans = getOrphans(db, vault);
      expect(orphans.some((p) => p === "Orphan.md")).toBe(true);
    });
  });

  describe("getNeighbors", () => {
    it("finds neighbors within 1 hop", () => {
      const neighbors = getNeighbors(db, vault, "Welcome.md", 1);
      expect(neighbors.nodes.length).toBeGreaterThan(1);
    });

    it("finds more neighbors at depth 2", () => {
      const n1 = getNeighbors(db, vault, "Welcome.md", 1);
      const n2 = getNeighbors(db, vault, "Welcome.md", 2);
      expect(n2.nodes.length).toBeGreaterThanOrEqual(n1.nodes.length);
    });
  });
});
