import { Database } from "../index/sqlite.js";
import { Vault } from "../core/vault.js";
import type { Graph, GraphNode, GraphEdge, LinkType } from "../core/types.js";

// ── Internal row shapes ───────────────────────────────────────────────────────

interface LinkRow {
  source_path: string;
  target_path: string;
  link_type: string;
  line_number: number | null;
}

// ── Helper: strip .md extension to get canonical note id ─────────────────────

function stripMd(p: string): string {
  return p.endsWith(".md") ? p.slice(0, -3) : p;
}

// ── Helper: build bidirectional adjacency list ────────────────────────────────

/**
 * Build a Map<notePath, Set<notePath>> representing bidirectional edges.
 * Keys and values are vault-relative paths (e.g. "Projects/Alpha.md").
 */
function buildAdjacencyList(db: Database, vault: Vault): Map<string, Set<string>> {
  const adj: Map<string, Set<string>> = new Map();

  const rows = db.raw
    .prepare(
      `SELECT n.path AS source_path, l.target_path, l.link_type, l.line_number
       FROM links l
       INNER JOIN notes n ON n.id = l.source_note_id`
    )
    .all() as LinkRow[];

  for (const row of rows) {
    const sourcePath = row.source_path;
    const resolved = vault.resolveLink(row.target_path);
    if (!resolved) continue;

    // Forward edge
    if (!adj.has(sourcePath)) adj.set(sourcePath, new Set());
    adj.get(sourcePath)!.add(resolved);

    // Reverse edge
    if (!adj.has(resolved)) adj.set(resolved, new Set());
    adj.get(resolved)!.add(sourcePath);
  }

  return adj;
}

// ── getBacklinks ──────────────────────────────────────────────────────────────

export interface BacklinkResult {
  sourcePath: string;
  line: number | undefined;
  linkType: LinkType;
  context: string | undefined;
}

/**
 * Find all notes that link to `targetNote`.
 * `targetNote` may be given with or without the .md extension,
 * and may be a full path like "Projects/Alpha" or "Projects/Alpha.md".
 */
export function getBacklinks(db: Database, vault: Vault, targetNote: string): BacklinkResult[] {
  // Normalise to the "wikilink target" form (no .md)
  const targetStripped = stripMd(targetNote);

  // Also accept the resolved full path (with .md)
  const resolved = vault.resolveLink(targetStripped);

  // Collect all target_path variants to match against
  const candidates = new Set<string>([targetStripped]);
  if (resolved) {
    candidates.add(resolved);
    candidates.add(stripMd(resolved));
  }

  // Query links whose target_path matches any candidate
  const placeholders = Array.from(candidates)
    .map(() => "?")
    .join(", ");
  const rows = db.raw
    .prepare(
      `SELECT n.path AS source_path, l.target_path, l.link_type, l.line_number
       FROM links l
       INNER JOIN notes n ON n.id = l.source_note_id
       WHERE l.target_path IN (${placeholders})`
    )
    .all(...Array.from(candidates)) as LinkRow[];

  return rows.map((row) => {
    // Try to read the line context from the source file
    let context: string | undefined;
    const lineNum = row.line_number;
    if (lineNum !== null && lineNum !== undefined && vault.exists(row.source_path)) {
      try {
        const lines = vault.readFile(row.source_path).split("\n");
        const idx = lineNum - 1; // line_number is 1-based
        context = idx >= 0 && idx < lines.length ? lines[idx].trim() : undefined;
      } catch {
        // ignore read errors
      }
    }

    return {
      sourcePath: row.source_path,
      line: lineNum ?? undefined,
      linkType: row.link_type as LinkType,
      context,
    };
  });
}

// ── getOutlinks ───────────────────────────────────────────────────────────────

export interface OutlinkResult {
  targetPath: string;
  resolvedPath: string | null;
  linkType: LinkType;
  line: number | undefined;
}

/**
 * Return all links originating from `sourcePath`.
 */
export function getOutlinks(db: Database, vault: Vault, sourcePath: string): OutlinkResult[] {
  const note = db.getNoteByPath(sourcePath);
  if (!note) return [];

  const rows = db.raw
    .prepare(
      `SELECT l.target_path, l.link_type, l.line_number
       FROM links l
       WHERE l.source_note_id = ?`
    )
    .all(note.id) as Array<{ target_path: string; link_type: string; line_number: number | null }>;

  return rows.map((row) => ({
    targetPath: row.target_path,
    resolvedPath: vault.resolveLink(row.target_path),
    linkType: row.link_type as LinkType,
    line: row.line_number ?? undefined,
  }));
}

// ── getGraph ──────────────────────────────────────────────────────────────────

export interface GetGraphFilter {
  folder?: string;
}

/**
 * Build the full vault graph (or a folder-scoped subgraph).
 */
export function getGraph(db: Database, vault: Vault, filter?: GetGraphFilter): Graph {
  // Gather all notes
  let allNotes = db.getAllNotes();
  if (filter?.folder) {
    const prefix = filter.folder.endsWith("/") ? filter.folder : `${filter.folder}/`;
    allNotes = allNotes.filter((n) => n.path.startsWith(prefix));
  }

  const notePathSet = new Set(allNotes.map((n) => n.path));

  // Build nodes
  const nodes: GraphNode[] = allNotes.map((n) => {
    const fm = JSON.parse(n.frontmatter_json) as Record<string, unknown>;
    const title = (fm.title as string | undefined) ?? n.path;
    const tags = db.raw
      .prepare(`SELECT tag FROM tags WHERE note_id = ?`)
      .all(n.id) as Array<{ tag: string }>;
    return {
      path: n.path,
      title,
      tags: tags.map((t) => t.tag),
    };
  });

  // Build edges — only those where both endpoints are in the filtered set
  const rows = db.raw
    .prepare(
      `SELECT n.path AS source_path, l.target_path, l.link_type
       FROM links l
       INNER JOIN notes n ON n.id = l.source_note_id`
    )
    .all() as Array<{ source_path: string; target_path: string; link_type: string }>;

  const edges: GraphEdge[] = [];
  for (const row of rows) {
    if (!notePathSet.has(row.source_path)) continue;
    const resolved = vault.resolveLink(row.target_path);
    if (!resolved || !notePathSet.has(resolved)) continue;
    edges.push({
      source: row.source_path,
      target: resolved,
      type: row.link_type as LinkType,
    });
  }

  return { nodes, edges };
}

// ── findPath ──────────────────────────────────────────────────────────────────

/**
 * BFS shortest path between two notes.
 * Returns an ordered array of paths, or null if unreachable.
 */
export function findPath(
  db: Database,
  vault: Vault,
  fromPath: string,
  toPath: string
): string[] | null {
  if (fromPath === toPath) return [fromPath];

  const adj = buildAdjacencyList(db, vault);

  // BFS
  const visited = new Set<string>([fromPath]);
  const queue: Array<{ node: string; path: string[] }> = [{ node: fromPath, path: [fromPath] }];

  while (queue.length > 0) {
    const { node, path: currentPath } = queue.shift()!;
    const neighbors = adj.get(node) ?? new Set<string>();

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      const newPath = [...currentPath, neighbor];
      if (neighbor === toPath) return newPath;
      visited.add(neighbor);
      queue.push({ node: neighbor, path: newPath });
    }
  }

  return null;
}

// ── getOrphans ────────────────────────────────────────────────────────────────

export type OrphanMode = "both" | "no-inlinks" | "no-outlinks";

/**
 * Find notes that are isolated from the graph.
 *
 * - "both" (default): no inlinks AND no outlinks
 * - "no-inlinks": nothing links to them
 * - "no-outlinks": they link to nothing
 */
export function getOrphans(db: Database, vault: Vault, mode: OrphanMode = "both"): string[] {
  const allNotes = db.getAllNotes();
  const results: string[] = [];

  for (const note of allNotes) {
    if (mode === "both" || mode === "no-outlinks") {
      // Check outlinks
      const outCount = (
        db.raw
          .prepare(`SELECT COUNT(*) as c FROM links WHERE source_note_id = ?`)
          .get(note.id) as { c: number }
      ).c;

      if (mode === "no-outlinks") {
        if (outCount === 0) results.push(note.path);
        continue;
      }

      // For "both", also need to check inlinks
      if (outCount > 0) continue;
    }

    // Check inlinks (for "both" and "no-inlinks" modes)
    // Target path in links table is the wikilink target (no .md)
    // We need to find if any link resolves to this note
    const allLinkTargets = db.raw
      .prepare(`SELECT target_path FROM links`)
      .all() as Array<{ target_path: string }>;

    const hasInlink = allLinkTargets.some((row) => {
      const resolved = vault.resolveLink(row.target_path);
      return resolved === note.path;
    });

    if (!hasInlink) {
      results.push(note.path);
    }
  }

  return results;
}

// ── getNeighbors ──────────────────────────────────────────────────────────────

/**
 * BFS subgraph up to `depth` hops from `notePath`.
 * Returns all visited nodes and the edges connecting them.
 */
export function getNeighbors(db: Database, vault: Vault, notePath: string, depth: number): Graph {
  const adj = buildAdjacencyList(db, vault);

  // BFS up to depth
  const visited = new Set<string>([notePath]);
  let frontier = new Set<string>([notePath]);

  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const node of frontier) {
      const neighbors = adj.get(node) ?? new Set<string>();
      for (const nb of neighbors) {
        if (!visited.has(nb)) {
          visited.add(nb);
          next.add(nb);
        }
      }
    }
    frontier = next;
  }

  // Build nodes for all visited paths
  const nodes: GraphNode[] = [];
  for (const p of visited) {
    const note = db.getNoteByPath(p);
    if (!note) continue;
    const fm = JSON.parse(note.frontmatter_json) as Record<string, unknown>;
    const title = (fm.title as string | undefined) ?? p;
    const tags = db.raw
      .prepare(`SELECT tag FROM tags WHERE note_id = ?`)
      .all(note.id) as Array<{ tag: string }>;
    nodes.push({ path: p, title, tags: tags.map((t) => t.tag) });
  }

  // Build edges — only those where both endpoints are in visited
  const rows = db.raw
    .prepare(
      `SELECT n.path AS source_path, l.target_path, l.link_type
       FROM links l
       INNER JOIN notes n ON n.id = l.source_note_id`
    )
    .all() as Array<{ source_path: string; target_path: string; link_type: string }>;

  const edges: GraphEdge[] = [];
  for (const row of rows) {
    if (!visited.has(row.source_path)) continue;
    const resolved = vault.resolveLink(row.target_path);
    if (!resolved || !visited.has(resolved)) continue;
    edges.push({
      source: row.source_path,
      target: resolved,
      type: row.link_type as LinkType,
    });
  }

  return { nodes, edges };
}
