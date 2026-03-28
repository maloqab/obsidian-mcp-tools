import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Database } from "../../src/index/sqlite.js";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { listTags, addTag, removeTag, renameTag, mergeTags } from "../../src/tools/tags.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const WORK_VAULT = path.resolve("tests/fixtures/work-vault-tags");
const TEST_DB = path.resolve("tests/fixtures/tags-tools-test.db");

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

describe("tag tools", () => {
  let db: Database; let vault: Vault; let indexer: Indexer;

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

  it("lists all tags with counts", () => {
    const tags = listTags(db);
    expect(tags.length).toBeGreaterThan(0);
    const project = tags.find(t => t.tag === "project");
    expect(project).toBeDefined();
    expect(project!.count).toBeGreaterThanOrEqual(2);
  });

  it("adds a tag to frontmatter", () => {
    addTag(vault, indexer, { path: "Welcome.md", tag: "new-tag", location: "frontmatter" });
    const content = vault.readFile("Welcome.md");
    expect(content).toContain("new-tag");
  });

  it("adds a tag inline", () => {
    addTag(vault, indexer, { path: "Welcome.md", tag: "inline-new", location: "inline" });
    const content = vault.readFile("Welcome.md");
    expect(content).toContain("#inline-new");
  });

  it("removes a tag from frontmatter", () => {
    removeTag(vault, indexer, { path: "Welcome.md", tag: "intro" });
    const content = vault.readFile("Welcome.md");
    expect(content).not.toContain("intro");
  });

  it("renames a tag across the vault", () => {
    renameTag(vault, indexer, db, { oldTag: "project", newTag: "proj" });
    const alphaContent = vault.readFile("Projects/Alpha.md");
    expect(alphaContent).toContain("proj");
    expect(alphaContent).not.toMatch(/tags:.*project[^-]/); // "project" gone, "proj" present
  });

  it("merges multiple tags into one", () => {
    mergeTags(vault, indexer, db, { sourceTags: ["getting-started", "intro"], targetTag: "onboarding" });
    const content = vault.readFile("Welcome.md");
    expect(content).toContain("onboarding");
  });
});
