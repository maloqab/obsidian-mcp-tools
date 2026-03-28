import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Vault } from "../../src/core/vault.js";
import { Indexer } from "../../src/index/indexer.js";
import { Database } from "../../src/index/sqlite.js";
import { listTemplates, applyTemplate, createTemplate } from "../../src/tools/templates.js";
import fs from "fs";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");
const WORK_VAULT = path.resolve("tests/fixtures/work-vault-templates");
const TEST_DB = path.resolve("tests/fixtures/templates-test.db");

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name); const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

describe("template tools", () => {
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

  it("lists available templates", () => {
    const templates = listTemplates(vault, "Templates");
    expect(templates.length).toBe(2);
    expect(templates.some(t => t.includes("Daily Template"))).toBe(true);
    expect(templates.some(t => t.includes("Project Template"))).toBe(true);
  });

  it("applies a template with variable substitution", () => {
    applyTemplate(vault, indexer, {
      template: "Templates/Project Template.md",
      targetPath: "Projects/New Project.md",
      variables: { title: "New Project", date: "2025-03-28", description: "A new project" },
    });
    expect(vault.exists("Projects/New Project.md")).toBe(true);
    const content = vault.readFile("Projects/New Project.md");
    expect(content).toContain("New Project");
    expect(content).toContain("2025-03-28");
    expect(content).toContain("A new project");
    expect(content).not.toContain("{{");
  });

  it("applies a template with auto date variable", () => {
    applyTemplate(vault, indexer, {
      template: "Templates/Daily Template.md",
      targetPath: "Daily/Today.md",
      variables: {},
    });
    expect(vault.exists("Daily/Today.md")).toBe(true);
    const content = vault.readFile("Daily/Today.md");
    // {{date}} should be replaced with today's date
    expect(content).not.toContain("{{date}}");
  });

  it("creates a new template", () => {
    createTemplate(vault, {
      path: "Templates/Custom.md",
      content: "---\ntitle: \"{{title}}\"\n---\n\n# {{title}}\n\n{{body}}",
    });
    expect(vault.exists("Templates/Custom.md")).toBe(true);
  });
});
