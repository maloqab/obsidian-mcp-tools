import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Database } from "./index/sqlite.js";
import { Vault } from "./core/vault.js";
import { Indexer } from "./index/indexer.js";
import { FtsIndex } from "./index/fts.js";
import { TrigramIndex } from "./index/trigram.js";
import { HybridSearch } from "./index/hybrid.js";
import { vaultStats, listFiles } from "./tools/vault.js";
import { readNote, createNote, editNote, deleteNote, moveNote, splitNote, mergeNotes, duplicateNote } from "./tools/notes.js";
import { searchVault, searchReplace, searchByDate, searchByFrontmatter, searchSimilar } from "./tools/search.js";
import { getBacklinks, getOutlinks, getGraph, findPath, getOrphans, getNeighbors } from "./tools/graph.js";
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

  const fts = new FtsIndex(defaultDb);
  const trigram = new TrigramIndex(defaultDb);
  trigram.buildIndex();
  const hybrid = new HybridSearch(fts, trigram, null);

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

  server.tool(
    "move_note",
    "Move or rename a note, optionally updating all wikilinks that reference the old path",
    {
      path: z.string().describe("Current relative path of the note"),
      newPath: z.string().describe("New relative path for the note"),
      updateLinks: z
        .boolean()
        .optional()
        .describe("Update wikilinks in other notes pointing to the old path (default: true)"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, newPath, updateLinks, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const idx = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      moveNote(v, idx, d, { path: notePath, newPath, updateLinks });
      return { content: [{ type: "text", text: `Moved: ${notePath} → ${newPath}` }] };
    }
  );

  server.tool(
    "split_note",
    "Split a note into multiple notes, one per heading at the specified level",
    {
      path: z.string().describe("Relative path of the note to split"),
      byHeadingLevel: z
        .number()
        .int()
        .min(1)
        .max(6)
        .describe("Heading level to split on (1–6, e.g. 2 for ## headings)"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, byHeadingLevel, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const idx = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      const created = splitNote(v, idx, { path: notePath, byHeadingLevel });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ created }, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    "merge_notes",
    "Merge multiple notes into a single target note, separated by horizontal rules",
    {
      paths: z
        .array(z.string())
        .describe("Ordered list of relative note paths to merge"),
      targetPath: z.string().describe("Relative path for the merged output note"),
      deleteOriginals: z
        .boolean()
        .optional()
        .describe("Delete the source notes after merging (default: false)"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ paths, targetPath, deleteOriginals, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const idx = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      mergeNotes(v, idx, { paths, targetPath, deleteOriginals });
      return { content: [{ type: "text", text: `Merged ${paths.length} notes into: ${targetPath}` }] };
    }
  );

  server.tool(
    "duplicate_note",
    "Copy a note to a new path without modifying the original",
    {
      path: z.string().describe("Relative path of the note to duplicate"),
      newPath: z.string().describe("Relative path for the new copy"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, newPath, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const idx = ctx.indexers[vaultIdx ?? 0] ?? defaultIndexer;
      duplicateNote(v, idx, { path: notePath, newPath });
      return { content: [{ type: "text", text: `Duplicated: ${notePath} → ${newPath}` }] };
    }
  );

  // ── Search tools ───────────────────────────────────────────────────────────

  server.tool(
    "search_vault",
    "Search notes using hybrid full-text and trigram search. Returns ranked results with optional snippets.",
    {
      query: z.string().describe("Search query"),
      mode: z
        .enum(["hybrid", "fts", "trigram", "semantic"])
        .optional()
        .describe("Search mode (default: hybrid)"),
      limit: z.number().optional().describe("Maximum results to return (default: 50)"),
      filterPaths: z
        .array(z.string())
        .optional()
        .describe("Restrict search to these note paths"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ query, mode, limit, filterPaths, vault: vaultIdx }) => {
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      let searchHybrid = hybrid;
      if (vaultIdx && vaultIdx !== 0) {
        const vFts = new FtsIndex(d);
        const vTrigram = new TrigramIndex(d);
        vTrigram.buildIndex();
        searchHybrid = new HybridSearch(vFts, vTrigram, null);
      }
      const results = await searchVault(searchHybrid, { query, mode, limit, filterPaths });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "search_replace",
    "Find and replace text across all notes in the vault. Supports plain text and regex patterns.",
    {
      search: z.string().describe("Text or regex pattern to search for"),
      replace: z.string().describe("Replacement text"),
      regex: z.boolean().optional().describe("Treat search as a regular expression (default: false)"),
      preview: z
        .boolean()
        .optional()
        .describe("Preview matches without applying changes (default: false)"),
      paths: z
        .array(z.string())
        .optional()
        .describe("Restrict search/replace to these note paths"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ search, replace, regex, preview, paths, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const matches = searchReplace(v, d, { search, replace, regex, preview, paths });
      return { content: [{ type: "text", text: JSON.stringify(matches, null, 2) }] };
    },
  );

  server.tool(
    "search_by_date",
    "Find notes filtered by creation or modification date. Dates should be ISO 8601 strings.",
    {
      after: z.string().optional().describe("Return notes after this date (ISO 8601)"),
      before: z.string().optional().describe("Return notes before this date (ISO 8601)"),
      field: z
        .enum(["created", "modified"])
        .optional()
        .describe("Date field to filter on (default: modified)"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ after, before, field, vault: vaultIdx }) => {
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const results = searchByDate(d, { after, before, field });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "search_by_frontmatter",
    "Find notes by a frontmatter field value. Can check for field existence or match a specific value.",
    {
      field: z.string().describe("Frontmatter field name (e.g. 'status', 'tags')"),
      value: z.string().optional().describe("Match notes where the field equals this value"),
      exists: z
        .boolean()
        .optional()
        .describe("true = field must exist, false = field must not exist"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ field, value, exists, vault: vaultIdx }) => {
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const results = searchByFrontmatter(d, { field, value, exists });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "search_similar",
    "Find notes semantically similar to a given note using vector embeddings. Returns empty results if no embeddings are indexed.",
    {
      path: z.string().describe("Relative path of the reference note"),
      limit: z.number().optional().describe("Maximum number of similar notes to return (default: 10)"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, limit, vault: vaultIdx }) => {
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const results = await searchSimilar(d, { path: notePath, limit });
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  // ── Graph tools ────────────────────────────────────────────────────────────

  server.tool(
    "get_backlinks",
    "Find all notes that link to a given note. Returns source paths, link types, and line context.",
    {
      path: z.string().describe("Target note path (e.g. 'Projects/Alpha' or 'Projects/Alpha.md')"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const results = getBacklinks(d, v, notePath);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "get_outlinks",
    "Find all notes linked from a given note. Returns target paths, resolved paths, link types, and line numbers.",
    {
      path: z.string().describe("Source note path (e.g. 'Welcome.md')"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const results = getOutlinks(d, v, notePath);
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.tool(
    "get_graph",
    "Build the full vault link graph (or a folder-scoped subgraph). Returns nodes and edges.",
    {
      folder: z.string().optional().describe("Restrict graph to notes inside this folder"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ folder, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const graph = getGraph(d, v, folder ? { folder } : undefined);
      return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] };
    },
  );

  server.tool(
    "find_path",
    "Find the shortest link path between two notes using BFS. Returns an ordered list of note paths or null if unreachable.",
    {
      from: z.string().describe("Starting note path"),
      to: z.string().describe("Target note path"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ from: fromPath, to: toPath, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const chain = findPath(d, v, fromPath, toPath);
      return { content: [{ type: "text", text: JSON.stringify({ path: chain }, null, 2) }] };
    },
  );

  server.tool(
    "get_orphans",
    "Find notes that have no inlinks, no outlinks, or both (fully isolated notes).",
    {
      mode: z
        .enum(["both", "no-inlinks", "no-outlinks"])
        .optional()
        .describe("Orphan mode: 'both' (default) = no inlinks AND no outlinks; 'no-inlinks' = nothing links to them; 'no-outlinks' = they link to nothing"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ mode, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const orphans = getOrphans(d, v, mode);
      return { content: [{ type: "text", text: JSON.stringify(orphans, null, 2) }] };
    },
  );

  server.tool(
    "get_neighbors",
    "Get a subgraph of all notes within N hops of a starting note, including their interconnecting edges.",
    {
      path: z.string().describe("Starting note path"),
      depth: z.number().int().min(1).describe("Number of hops from the starting note"),
      vault: z.number().optional().describe("Vault index (default: 0)"),
    },
    async ({ path: notePath, depth, vault: vaultIdx }) => {
      const v = ctx.vaults[vaultIdx ?? 0] ?? defaultVault;
      const d = ctx.databases[vaultIdx ?? 0] ?? defaultDb;
      const subgraph = getNeighbors(d, v, notePath, depth);
      return { content: [{ type: "text", text: JSON.stringify(subgraph, null, 2) }] };
    },
  );

  return server;
}
