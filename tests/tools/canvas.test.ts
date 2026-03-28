import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { Database } from "../../src/index/sqlite.js";
import { readCanvas, createCanvas, editCanvas, canvasToNotes } from "../../src/tools/canvas.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const WORK_VAULT = path.resolve("tests/fixtures/work-vault-canvas");
const TEST_DB = path.resolve("tests/fixtures/canvas-test.db");

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

describe("canvas tools", () => {
  let vault: Vault; let indexer: Indexer; let db: Database;

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

  it("reads a canvas file", () => {
    const canvas = readCanvas(vault, { path: "Canvas/Board.canvas" });
    expect(canvas.nodes).toHaveLength(3);
    expect(canvas.edges).toHaveLength(2);
    expect(canvas.nodes[0].type).toBe("text");
  });

  it("creates a new canvas", () => {
    createCanvas(vault, {
      path: "Canvas/New.canvas",
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 200, height: 100, text: "Hello" }],
      edges: [],
    });
    expect(vault.exists("Canvas/New.canvas")).toBe(true);
    const canvas = readCanvas(vault, { path: "Canvas/New.canvas" });
    expect(canvas.nodes).toHaveLength(1);
  });

  it("edits a canvas (add node)", () => {
    editCanvas(vault, {
      path: "Canvas/Board.canvas",
      addNodes: [{ id: "node4", type: "text", x: 500, y: 0, width: 200, height: 100, text: "New node" }],
    });
    const canvas = readCanvas(vault, { path: "Canvas/Board.canvas" });
    expect(canvas.nodes).toHaveLength(4);
  });

  it("edits a canvas (remove node)", () => {
    editCanvas(vault, {
      path: "Canvas/Board.canvas",
      removeNodeIds: ["node2"],
    });
    const canvas = readCanvas(vault, { path: "Canvas/Board.canvas" });
    expect(canvas.nodes).toHaveLength(2);
    // Edge from node1 to node2 should also be removed
    expect(canvas.edges.some(e => e.fromNode === "node2" || e.toNode === "node2")).toBe(false);
  });

  it("extracts canvas text nodes to notes", () => {
    const created = canvasToNotes(vault, indexer, {
      path: "Canvas/Board.canvas",
      outputFolder: "Canvas/Extracted",
    });
    expect(created.length).toBe(2); // 2 text nodes (node3 is file type)
    expect(vault.exists(created[0])).toBe(true);
  });
});
