import fs from "fs";
import path from "path";
import type { Config } from "./types.js";

export const DEFAULT_CONFIG: Config = {
  search: {
    weights: { fts: 0.4, trigram: 0.2, vector: 0.4 },
    embeddingProvider: "local",
    embeddingModel: "gte-small",
  },
  index: {
    watchMode: true,
    excludePaths: [".obsidian", ".trash", "node_modules", ".git"],
    excludePatterns: [],
  },
  templates: {
    folder: "Templates",
  },
  notes: {
    trashInsteadOfDelete: true,
    trashFolder: ".trash",
    autoUpdateLinks: true,
  },
  dataview: {
    enableJsQueries: false,
  },
};

function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const val = override[key];
    if (val && typeof val === "object" && !Array.isArray(val) && typeof (base as Record<string, unknown>)[key] === "object") {
      (result as Record<string, unknown>)[key] = deepMerge(
        (base as Record<string, unknown>)[key] as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

export function loadConfig(vaultPath: string, overrides?: Record<string, unknown>): Config {
  const configPath = path.join(vaultPath, ".obsidian-mcp-tools.json");
  let fileConfig: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8");
    fileConfig = JSON.parse(raw);
  }

  let config = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, fileConfig);
  if (overrides) {
    config = deepMerge(config, overrides);
  }

  return config as unknown as Config;
}
