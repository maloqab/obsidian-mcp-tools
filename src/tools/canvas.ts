import { Vault } from "../core/vault.js";
import { Indexer } from "../index/indexer.js";
import type { Canvas, CanvasNode, CanvasEdge } from "../core/types.js";

// ── readCanvas ────────────────────────────────────────────────────────────────

export interface ReadCanvasOptions {
  path: string;
}

export function readCanvas(vault: Vault, opts: ReadCanvasOptions): Canvas {
  if (!vault.exists(opts.path)) {
    throw new Error(`Canvas not found: ${opts.path}`);
  }
  const raw = vault.readFile(opts.path);
  return JSON.parse(raw) as Canvas;
}

// ── createCanvas ──────────────────────────────────────────────────────────────

export interface CreateCanvasOptions {
  path: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export function createCanvas(vault: Vault, opts: CreateCanvasOptions): void {
  const canvas: Canvas = { nodes: opts.nodes, edges: opts.edges };
  vault.writeFile(opts.path, JSON.stringify(canvas, null, 2));
}

// ── editCanvas ────────────────────────────────────────────────────────────────

export interface EditCanvasOptions {
  path: string;
  addNodes?: CanvasNode[];
  removeNodeIds?: string[];
  addEdges?: CanvasEdge[];
  removeEdgeIds?: string[];
  updateNodes?: CanvasNode[];
}

export function editCanvas(vault: Vault, opts: EditCanvasOptions): void {
  if (!vault.exists(opts.path)) {
    throw new Error(`Canvas not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);
  const canvas: Canvas = JSON.parse(raw);

  // Track which node ids are being removed (including from updateNodes replacements)
  const removeNodeIdSet = new Set(opts.removeNodeIds ?? []);

  // Remove nodes
  let nodes = canvas.nodes.filter((n) => !removeNodeIdSet.has(n.id));

  // Remove edges connected to removed nodes, plus explicit removeEdgeIds
  const removeEdgeIdSet = new Set(opts.removeEdgeIds ?? []);
  let edges = canvas.edges.filter(
    (e) =>
      !removeEdgeIdSet.has(e.id) &&
      !removeNodeIdSet.has(e.fromNode) &&
      !removeNodeIdSet.has(e.toNode)
  );

  // Update existing nodes
  if (opts.updateNodes && opts.updateNodes.length > 0) {
    const updateMap = new Map(opts.updateNodes.map((n) => [n.id, n]));
    nodes = nodes.map((n) => updateMap.get(n.id) ?? n);
  }

  // Add new nodes
  if (opts.addNodes && opts.addNodes.length > 0) {
    nodes = [...nodes, ...opts.addNodes];
  }

  // Add new edges
  if (opts.addEdges && opts.addEdges.length > 0) {
    edges = [...edges, ...opts.addEdges];
  }

  const updated: Canvas = { nodes, edges };
  vault.writeFile(opts.path, JSON.stringify(updated, null, 2));
}

// ── canvasToNotes ─────────────────────────────────────────────────────────────

export interface CanvasToNotesOptions {
  path: string;
  outputFolder: string;
}

export function canvasToNotes(
  vault: Vault,
  indexer: Indexer,
  opts: CanvasToNotesOptions
): string[] {
  if (!vault.exists(opts.path)) {
    throw new Error(`Canvas not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);
  const canvas: Canvas = JSON.parse(raw);

  const created: string[] = [];
  let counter = 1;

  for (const node of canvas.nodes) {
    if (node.type !== "text") continue;

    const text = node.text ?? "";

    // Derive filename from first heading or fallback to node id
    let title = node.id;
    const headingMatch = text.match(/^#{1,6}\s+(.+)/m);
    if (headingMatch) {
      title = headingMatch[1].trim().replace(/[/\\:*?"<>|]/g, "").trim();
    }

    // Ensure uniqueness by appending counter if needed
    let notePath = `${opts.outputFolder}/${title}.md`;
    if (vault.exists(notePath)) {
      notePath = `${opts.outputFolder}/${title}-${counter}.md`;
      counter++;
    }

    vault.writeFile(notePath, text);
    indexer.indexSingleFile(notePath);
    created.push(notePath);
  }

  return created;
}
