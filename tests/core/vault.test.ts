import { describe, it, expect } from "vitest";
import { Vault } from "../../src/core/vault.js";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");

describe("Vault", () => {
  it("loads all markdown files from vault", () => {
    const vault = new Vault(FIXTURE_VAULT);
    const files = vault.listMarkdownFiles();
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f === "Welcome.md")).toBe(true);
    expect(files.some((f) => f === "Projects/Alpha.md")).toBe(true);
  });

  it("excludes .obsidian directory", () => {
    const vault = new Vault(FIXTURE_VAULT);
    const files = vault.listMarkdownFiles();
    expect(files.some((f) => f.startsWith(".obsidian"))).toBe(false);
  });

  it("reads a note by path", () => {
    const vault = new Vault(FIXTURE_VAULT);
    const content = vault.readFile("Welcome.md");
    expect(content).toContain("Welcome to the Vault");
  });

  it("resolves a wikilink target to a file path", () => {
    const vault = new Vault(FIXTURE_VAULT);
    const resolved = vault.resolveLink("Projects/Alpha");
    expect(resolved).toBe("Projects/Alpha.md");
  });

  it("resolves a wikilink without folder prefix", () => {
    const vault = new Vault(FIXTURE_VAULT);
    const resolved = vault.resolveLink("Welcome");
    expect(resolved).toBe("Welcome.md");
  });

  it("returns null for unresolvable links", () => {
    const vault = new Vault(FIXTURE_VAULT);
    const resolved = vault.resolveLink("Nonexistent Note");
    expect(resolved).toBeNull();
  });

  it("checks if a file exists", () => {
    const vault = new Vault(FIXTURE_VAULT);
    expect(vault.exists("Welcome.md")).toBe(true);
    expect(vault.exists("Nope.md")).toBe(false);
  });

  it("lists all files including non-markdown", () => {
    const vault = new Vault(FIXTURE_VAULT);
    const allFiles = vault.listAllFiles();
    expect(allFiles.some((f) => f.endsWith(".canvas"))).toBe(true);
  });
});
