import matter from "gray-matter";
import yaml from "yaml";
import { Vault } from "../core/vault.js";
import { Database } from "../index/sqlite.js";
import { Indexer } from "../index/indexer.js";

// ── Section helpers ──────────────────────────────────────────────────────────

/** Parse the heading level from a markdown heading line (e.g. "## Foo" → 2). */
function headingLevel(line: string): number | null {
  const m = line.match(/^(#{1,6})\s/);
  return m ? m[1].length : null;
}

/**
 * Find the line index (0-based) of the first heading whose text matches
 * `sectionName` (case-insensitive). Returns -1 if not found.
 */
function findSectionStart(lines: string[], sectionName: string): number {
  const target = sectionName.toLowerCase().trim();
  for (let i = 0; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl !== null) {
      const text = lines[i].replace(/^#+\s*/, "").trim().toLowerCase();
      if (text === target) return i;
    }
  }
  return -1;
}

/**
 * Extract the content of a section (lines from `startIdx+1` until the next
 * heading of equal or higher level, or end of file). Returns the section
 * heading line + body.
 */
function extractSection(lines: string[], startIdx: number): string {
  const level = headingLevel(lines[startIdx])!;
  const result: string[] = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl !== null && lvl <= level) break;
    result.push(lines[i]);
  }
  return result.join("\n");
}

/**
 * Replace the body (content after the heading) of the section starting at
 * `startIdx` with `newBody`. Returns a new lines array.
 */
function replaceSection(lines: string[], startIdx: number, newBody: string): string[] {
  const level = headingLevel(lines[startIdx])!;

  // Find where section ends
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl !== null && lvl <= level) {
      endIdx = i;
      break;
    }
  }

  const before = lines.slice(0, startIdx + 1); // include the heading itself
  const after = lines.slice(endIdx);

  // Normalise: if newBody doesn't start with blank line, add one
  const bodyLines = newBody.split("\n");
  return [...before, "", ...bodyLines, ...after];
}

// ── Frontmatter helpers ──────────────────────────────────────────────────────

function buildFrontmatter(data: Record<string, unknown>): string {
  return `---\n${yaml.stringify(data).trimEnd()}\n---`;
}

// ── Exported tool functions ──────────────────────────────────────────────────

export interface ReadNoteOptions {
  path: string;
  section?: string;
}

export interface ReadNoteResult {
  content: string;
  frontmatter: Record<string, unknown>;
  path: string;
}

export function readNote(vault: Vault, _db: Database, opts: ReadNoteOptions): ReadNoteResult {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);
  const parsed = matter(raw);
  const frontmatter = parsed.data as Record<string, unknown>;

  if (opts.section) {
    const lines = raw.split("\n");
    const startIdx = findSectionStart(lines, opts.section);
    if (startIdx === -1) {
      throw new Error(`Section "${opts.section}" not found in ${opts.path}`);
    }
    const sectionContent = extractSection(lines, startIdx);
    return { content: sectionContent, frontmatter, path: opts.path };
  }

  return { content: raw, frontmatter, path: opts.path };
}

// ────────────────────────────────────────────────────────────────────────────

export interface CreateNoteOptions {
  path: string;
  content: string;
  frontmatter?: Record<string, unknown>;
}

export function createNote(vault: Vault, indexer: Indexer, opts: CreateNoteOptions): void {
  if (vault.exists(opts.path)) {
    throw new Error(`Note already exists: ${opts.path}`);
  }

  let finalContent: string;

  if (opts.frontmatter && Object.keys(opts.frontmatter).length > 0) {
    const fm = buildFrontmatter(opts.frontmatter);
    finalContent = `${fm}\n${opts.content}`;
  } else {
    finalContent = opts.content;
  }

  vault.writeFile(opts.path, finalContent);
  indexer.indexSingleFile(opts.path);
}

// ────────────────────────────────────────────────────────────────────────────

export interface EditNoteOptions {
  path: string;
  content: string;
  section?: string;
}

export function editNote(vault: Vault, indexer: Indexer, opts: EditNoteOptions): void {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  if (opts.section) {
    const raw = vault.readFile(opts.path);
    const lines = raw.split("\n");
    const startIdx = findSectionStart(lines, opts.section);
    if (startIdx === -1) {
      throw new Error(`Section "${opts.section}" not found in ${opts.path}`);
    }
    const newLines = replaceSection(lines, startIdx, opts.content);
    vault.writeFile(opts.path, newLines.join("\n"));
  } else {
    vault.writeFile(opts.path, opts.content);
  }

  indexer.indexSingleFile(opts.path);
}

// ────────────────────────────────────────────────────────────────────────────

export interface DeleteNoteOptions {
  path: string;
  trash?: boolean;
  trashFolder?: string;
}

export function deleteNote(
  vault: Vault,
  indexer: Indexer,
  _db: Database,
  opts: DeleteNoteOptions
): void {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  if (opts.trash) {
    const trashFolder = opts.trashFolder ?? ".trash";
    const basename = opts.path.split("/").pop()!;
    const trashPath = `${trashFolder}/${basename}`;
    vault.moveFile(opts.path, trashPath);
  } else {
    vault.deleteFile(opts.path);
  }

  indexer.removeFile(opts.path);
}
