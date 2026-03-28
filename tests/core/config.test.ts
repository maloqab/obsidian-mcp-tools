import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_CONFIG } from "../../src/core/config.js";
import path from "path";

const FIXTURE_VAULT = path.resolve("tests/fixtures/test-vault");

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadConfig(FIXTURE_VAULT);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config over defaults", () => {
    const config = loadConfig(FIXTURE_VAULT, {
      search: { weights: { fts: 0.6, trigram: 0.1, vector: 0.3 } },
    });
    expect(config.search.weights.fts).toBe(0.6);
    expect(config.search.embeddingProvider).toBe("local");
  });

  it("preserves default excludePaths", () => {
    const config = loadConfig(FIXTURE_VAULT);
    expect(config.index.excludePaths).toContain(".obsidian");
    expect(config.index.excludePaths).toContain(".trash");
  });
});
