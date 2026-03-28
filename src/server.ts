import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Database } from "./index/sqlite.js";
import { Vault } from "./core/vault.js";
import { Indexer } from "./index/indexer.js";
import { vaultStats, listFiles } from "./tools/vault.js";
import { readNote, createNote, editNote, deleteNote } from "./tools/notes.js";
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

  // ── Note CRUD tools ────────────────────────────────────────────────────────

  server.tool(
    "read_note",
    "Read the full content of a note, or a specific heading section within it",
    {
      path: z.string().describe("Relative path to the note (e.g. 'Projects/Alpha.md')"),
      section: z.string().optional().describe("Heading name to extract (e.g. 'Tasks')"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, section, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const result = readNote(v, d, { path: notePath, section });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { path: result.path, frontmatter: result.frontmatter, content: result.content },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    "create_note",
    "Create a new note with optional YAML frontmatter",
    {
      path: z.string().describe("Relative path for the new note (e.g. 'Ideas/My Note.md')"),
      content: z.string().describe("Markdown body content"),
      frontmatter: z
        .record(z.unknown())
        .optional()
        .describe("Key/value pairs to add as YAML frontmatter"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, content, frontmatter, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const idx = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      createNote(v, idx, { path: notePath, content, frontmatter });
      return { content: [{ type: "text", text: `Created: ${notePath}` }] };
    }
  );

  server.tool(
    "edit_note",
    "Replace a note's full content, or patch a specific heading section",
    {
      path: z.string().describe("Relative path to the note"),
      content: z.string().describe("New content (full note body or section body)"),
      section: z
        .string()
        .optional()
        .describe("Heading name to patch in-place (leave empty to replace entire note)"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, content, section, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const idx = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      editNote(v, idx, { path: notePath, content, section });
      return { content: [{ type: "text", text: `Edited: ${notePath}` }] };
    }
  );

  server.tool(
    "delete_note",
    "Delete a note permanently or move it to a trash folder",
    {
      path: z.string().describe("Relative path to the note"),
      trash: z
        .boolean()
        .optional()
        .describe("Move to trash folder instead of permanent delete (default: false)"),
      trashFolder: z
        .string()
        .optional()
        .describe("Trash folder name (default: '.trash')"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, trash, trashFolder, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const idx = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      deleteNote(v, idx, d, { path: notePath, trash, trashFolder });
      const action = trash ? `moved to ${trashFolder ?? ".trash"}` : "deleted";
      return { content: [{ type: "text", text: `${notePath} ${action}` }] };
    }
  );

  return server;
}
