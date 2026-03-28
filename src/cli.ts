#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import path from "path";
import { createServer } from "./server.js";
import { Database } from "./index/sqlite.js";
import { Vault } from "./core/vault.js";
import { Indexer } from "./index/indexer.js";
import { loadConfig } from "./core/config.js";
import { FileWatcher } from "./core/watcher.js";

const DB_FILENAME = ".obsidian-mcp-tools.db";

function ensureGitignore(vaultPath: string): void {
  const gitignorePath = path.join(vaultPath, ".gitignore");
  try {
    if (fs.existsSync(gitignorePath)) {
      const contents = fs.readFileSync(gitignorePath, "utf8");
      const lines = contents.split("\n").map((l) => l.trim());
      if (lines.includes(DB_FILENAME)) return;
      const separator = contents.endsWith("\n") ? "" : "\n";
      fs.appendFileSync(gitignorePath, `${separator}${DB_FILENAME}\n`, "utf8");
    } else {
      fs.writeFileSync(gitignorePath, `${DB_FILENAME}\n`, "utf8");
    }
  } catch {
    // Non-fatal: silently skip if the vault root is not writable
  }
}

async function main() {
  const args = process.argv.slice(2);
  const vaultPaths = args.filter((a) => !a.startsWith("--"));
  const quiet = args.includes("--quiet");

  if (vaultPaths.length === 0) {
    console.error("Usage: obsidian-mcp-tools <vault-path> [vault-path...] [--verbose] [--quiet]");
    process.exit(1);
  }

  const log = (msg: string) => {
    if (!quiet) console.error(`[obsidian-mcp-tools] ${msg}`);
  };

  const vaults: Vault[] = [];
  const databases: Database[] = [];
  const indexers: Indexer[] = [];

  for (const vaultPath of vaultPaths) {
    const resolved = path.resolve(vaultPath);
    const config = loadConfig(resolved);
    const vault = new Vault(resolved, config);
    const dbPath = path.join(resolved, DB_FILENAME);
    const db = new Database(dbPath);
    ensureGitignore(resolved);
    const indexer = new Indexer(db, vault);

    log(`Indexing vault: ${resolved}`);
    const result = indexer.indexAll();
    log(`Indexed: ${result.indexed} new, ${result.skipped} unchanged, ${result.removed} removed`);

    vaults.push(vault);
    databases.push(db);
    indexers.push(indexer);
  }

  const config = loadConfig(vaultPaths[0]);

  if (config.index.watchMode) {
    for (let i = 0; i < vaults.length; i++) {
      const watcher = new FileWatcher(vaults[i], indexers[i], config.index.excludePaths, quiet);
      watcher.start();
    }
  }

  const server = createServer({ vaults, databases, indexers, config });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
