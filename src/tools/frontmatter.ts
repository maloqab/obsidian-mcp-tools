import matter from "gray-matter";
import yaml from "yaml";
import { Vault } from "../core/vault.js";
import { Database } from "../index/sqlite.js";
import { Indexer } from "../index/indexer.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reconstruct a file string with updated frontmatter while preserving the body. */
function rebuildFile(body: string, data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) {
    // No frontmatter — just return the body (trim leading newline gray-matter adds)
    return body.startsWith("\n") ? body.slice(1) : body;
  }
  const fmBlock = `---\n${yaml.stringify(data).trimEnd()}\n---`;
  // gray-matter sets content with a leading newline; normalise
  const normalBody = body.startsWith("\n") ? body.slice(1) : body;
  return `${fmBlock}\n${normalBody}`;
}

// ── getFrontmatter ────────────────────────────────────────────────────────────

export interface GetFrontmatterOptions {
  path: string;
  keys?: string[];
}

/**
 * Read a note's frontmatter. If `keys` is provided, return only those keys.
 * Returns an empty object if the note has no frontmatter.
 */
export function getFrontmatter(
  vault: Vault,
  opts: GetFrontmatterOptions
): Record<string, unknown> {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);
  const parsed = matter(raw);
  const fm = parsed.data as Record<string, unknown>;

  if (opts.keys && opts.keys.length > 0) {
    const filtered: Record<string, unknown> = {};
    for (const k of opts.keys) {
      if (k in fm) {
        filtered[k] = fm[k];
      }
    }
    return filtered;
  }

  return fm;
}

// ── setFrontmatter ────────────────────────────────────────────────────────────

export interface SetFrontmatterOptions {
  path: string;
  data: Record<string, unknown>;
}

/**
 * Merge `data` into the note's existing frontmatter. Existing keys not present
 * in `data` are preserved. Rewrites the file and re-indexes it.
 */
export function setFrontmatter(
  vault: Vault,
  indexer: Indexer,
  opts: SetFrontmatterOptions
): void {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);
  const parsed = matter(raw);
  const merged = { ...parsed.data, ...opts.data } as Record<string, unknown>;

  const newContent = rebuildFile(parsed.content, merged);
  vault.writeFile(opts.path, newContent);
  indexer.indexSingleFile(opts.path);
}

// ── deleteFrontmatter ─────────────────────────────────────────────────────────

export interface DeleteFrontmatterOptions {
  path: string;
  keys: string[];
}

/**
 * Delete the specified keys from the note's frontmatter. All other frontmatter
 * keys and the note body are preserved. Rewrites the file and re-indexes it.
 */
export function deleteFrontmatter(
  vault: Vault,
  indexer: Indexer,
  opts: DeleteFrontmatterOptions
): void {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);
  const parsed = matter(raw);
  const fm = { ...parsed.data } as Record<string, unknown>;

  for (const k of opts.keys) {
    delete fm[k];
  }

  const newContent = rebuildFile(parsed.content, fm);
  vault.writeFile(opts.path, newContent);
  indexer.indexSingleFile(opts.path);
}

// ── frontmatterSchema ─────────────────────────────────────────────────────────

export interface FrontmatterSchemaEntry {
  key: string;
  types: string[];
  count: number;
  examples: unknown[];
}

/**
 * Aggregate all frontmatter keys across all notes in the database.
 * Returns a sorted list of `{ key, types, count, examples }` entries.
 */
export function frontmatterSchema(db: Database): FrontmatterSchemaEntry[] {
  const notes = db.getAllNotes();

  const keyMap = new Map<
    string,
    { types: Set<string>; count: number; examples: unknown[] }
  >();

  for (const note of notes) {
    let fm: Record<string, unknown>;
    try {
      fm = JSON.parse(note.frontmatter_json) as Record<string, unknown>;
    } catch {
      continue;
    }

    for (const [key, value] of Object.entries(fm)) {
      if (!keyMap.has(key)) {
        keyMap.set(key, { types: new Set(), count: 0, examples: [] });
      }
      const entry = keyMap.get(key)!;
      entry.count++;

      // Determine type
      if (Array.isArray(value)) {
        entry.types.add("array");
      } else if (value === null) {
        entry.types.add("null");
      } else {
        entry.types.add(typeof value);
      }

      // Collect up to 3 unique examples
      if (entry.examples.length < 3) {
        const alreadyPresent = entry.examples.some(
          (ex) => JSON.stringify(ex) === JSON.stringify(value)
        );
        if (!alreadyPresent) {
          entry.examples.push(value);
        }
      }
    }
  }

  const result: FrontmatterSchemaEntry[] = [];
  for (const [key, data] of keyMap.entries()) {
    result.push({
      key,
      types: Array.from(data.types).sort(),
      count: data.count,
      examples: data.examples,
    });
  }

  // Sort by count descending, then key alphabetically
  result.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return result;
}
