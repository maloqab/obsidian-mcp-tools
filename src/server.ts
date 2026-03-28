import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Database } from "./index/sqlite.js";
import { Vault } from "./core/vault.js";
import { Indexer } from "./index/indexer.js";
import { vaultStats, listFiles } from "./tools/vault.js";
import type { Config } from "./core/types.js";
import fs from "fs";
import path from "path";

export interface ServerContext {
  vaults: Vault[];
  databases: Database[];
  indexers: Indexer[];
  config: Config;
}

export function createServer(ctx: ServerContext): McpServer {
  const server = new McpServer({
    name: "obsidian-mcp-tools",
    version: "0.1.0",
  });

  const defaultVault = ctx.vaults[0];
  const defaultDb = ctx.databases[0];
  const defaultIndexer = ctx.indexers[0];

  server.tool(
    "vault_stats",
    "Get vault statistics: note count, tag count, link count, size, and more",
    { vault: z.number().optional().describe("Vault index (default: 0)") },
    async ({ vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const stats = vaultStats(d, v);
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
    },
  );

  server.tool(
    "list_files",
    "List files and folders in the vault with optional filters (glob, extension, depth)",
    {
      glob: z.string().optional().describe("Glob pattern (e.g. 'Projects/**/*.md')"),
      extension: z.string().optional().describe("Filter by extension (e.g. '.md', '.canvas')"),
      maxDepth: z.number().optional().describe("Maximum directory depth"),
      vault: z.number().optional(),
    },
    async ({ glob, extension, maxDepth, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const files = listFiles(v, { glob, extension, maxDepth });
      return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
    },
  );

  server.tool(
    "list_vaults",
    "List all configured vaults with their paths",
    {},
    async () => {
      const list = ctx.vaults.map((v, i) => ({ index: i, path: v.rootPath }));
      return { content: [{ type: "text", text: JSON.stringify(list, null, 2) }] };
    },
  );

  server.tool(
    "create_directory",
    "Create a directory in the vault",
    {
      path: z.string().describe("Relative path for the directory"),
      vault: z.number().optional(),
    },
    async ({ path: dirPath, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const fullPath = path.join(v.rootPath, dirPath);
      fs.mkdirSync(fullPath, { recursive: true });
      return { content: [{ type: "text", text: `Created directory: ${dirPath}` }] };
    },
  );

  server.tool(
    "reindex",
    "Force a full re-index of the vault",
    { vault: z.number().optional() },
    async ({ vault: vaultIdx }) => {
      const indexer = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      const result = indexer.indexAll();
      return {
        content: [{ type: "text", text: `Re-indexed: ${result.indexed} indexed, ${result.skipped} unchanged, ${result.removed} removed` }],
      };
    },
  );

  return server;
}
