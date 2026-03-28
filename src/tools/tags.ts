import matter from "gray-matter";
import yaml from "yaml";
import { Vault } from "../core/vault.js";
import { Database } from "../index/sqlite.js";
import { Indexer } from "../index/indexer.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildFrontmatter(data: Record<string, unknown>): string {
  return `---\n${yaml.stringify(data).trimEnd()}\n---`;
}

// ── listTags ─────────────────────────────────────────────────────────────────

export interface TagCount {
  tag: string;
  count: number;
}

export function listTags(db: Database): TagCount[] {
  const rows = db.raw
    .prepare(
      `SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC`
    )
    .all() as Array<{ tag: string; count: number }>;
  return rows;
}

// ── addTag ───────────────────────────────────────────────────────────────────

export interface AddTagOptions {
  path: string;
  tag: string;
  location: "frontmatter" | "inline";
}

export function addTag(vault: Vault, indexer: Indexer, opts: AddTagOptions): void {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);

  if (opts.location === "frontmatter") {
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    let tags: string[] = [];
    if (Array.isArray(data.tags)) {
      tags = data.tags.map(String);
    } else if (typeof data.tags === "string") {
      tags = [data.tags];
    }

    if (!tags.includes(opts.tag)) {
      tags.push(opts.tag);
    }
    data.tags = tags;

    const fm = buildFrontmatter(data);
    const body = parsed.content ?? "";
    vault.writeFile(opts.path, `${fm}\n${body}`);
  } else {
    // inline: append #tag at end of file
    const trimmed = raw.trimEnd();
    vault.writeFile(opts.path, `${trimmed}\n#${opts.tag}\n`);
  }

  indexer.indexSingleFile(opts.path);
}

// ── removeTag ────────────────────────────────────────────────────────────────

export interface RemoveTagOptions {
  path: string;
  tag: string;
}

export function removeTag(vault: Vault, indexer: Indexer, opts: RemoveTagOptions): void {
  if (!vault.exists(opts.path)) {
    throw new Error(`Note not found: ${opts.path}`);
  }

  const raw = vault.readFile(opts.path);
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;

  // Remove from frontmatter tags array
  if (Array.isArray(data.tags)) {
    data.tags = data.tags.map(String).filter((t) => t !== opts.tag);
  } else if (typeof data.tags === "string" && data.tags === opts.tag) {
    data.tags = [];
  }

  // Remove inline occurrences like #tag (word boundary: not followed by alphanumeric or -)
  let body = parsed.content ?? "";
  const inlineRe = new RegExp(`#${escapeRegex(opts.tag)}(?![\\w-])`, "g");
  body = body.replace(inlineRe, "");

  const fm = buildFrontmatter(data);
  vault.writeFile(opts.path, `${fm}\n${body}`);

  indexer.indexSingleFile(opts.path);
}

// ── renameTag ─────────────────────────────────────────────────────────────────

export interface RenameTagOptions {
  oldTag: string;
  newTag: string;
}

export function renameTag(
  vault: Vault,
  indexer: Indexer,
  db: Database,
  opts: RenameTagOptions
): void {
  // Find all notes with the old tag
  const rows = db.raw
    .prepare(
      `SELECT DISTINCT n.path FROM tags t JOIN notes n ON t.note_id = n.id WHERE t.tag = ?`
    )
    .all(opts.oldTag) as Array<{ path: string }>;

  for (const row of rows) {
    if (!vault.exists(row.path)) continue;

    const raw = vault.readFile(row.path);
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;

    // Replace in frontmatter tags array
    if (Array.isArray(data.tags)) {
      data.tags = data.tags.map((t: unknown) =>
        String(t) === opts.oldTag ? opts.newTag : String(t)
      );
    } else if (typeof data.tags === "string" && data.tags === opts.oldTag) {
      data.tags = opts.newTag;
    }

    // Replace inline #oldTag with #newTag
    let body = parsed.content ?? "";
    const inlineRe = new RegExp(`#${escapeRegex(opts.oldTag)}(?![\\w-])`, "g");
    body = body.replace(inlineRe, `#${opts.newTag}`);

    const fm = buildFrontmatter(data);
    vault.writeFile(row.path, `${fm}\n${body}`);
    indexer.indexSingleFile(row.path);
  }
}

// ── mergeTags ─────────────────────────────────────────────────────────────────

export interface MergeTagsOptions {
  sourceTags: string[];
  targetTag: string;
}

export function mergeTags(
  vault: Vault,
  indexer: Indexer,
  db: Database,
  opts: MergeTagsOptions
): void {
  for (const sourceTag of opts.sourceTags) {
    renameTag(vault, indexer, db, { oldTag: sourceTag, newTag: opts.targetTag });
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
