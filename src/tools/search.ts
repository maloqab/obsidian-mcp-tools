import { Vault } from "../core/vault.js";
import { Database, NoteRow } from "../index/sqlite.js";
import { HybridSearch, HybridResult, HybridSearchOptions } from "../index/hybrid.js";

// ── searchVault ──────────────────────────────────────────────────────────────

export interface SearchVaultOptions extends HybridSearchOptions {
  query: string;
}

export interface SearchVaultResult {
  path: string;
  score: number;
  snippet?: string;
}

export async function searchVault(
  hybrid: HybridSearch,
  options: SearchVaultOptions,
): Promise<SearchVaultResult[]> {
  const { query, ...hybridOptions } = options;
  const results: HybridResult[] = await hybrid.search(query, hybridOptions);
  return results.map((r) => ({ path: r.path, score: r.score, snippet: r.snippet }));
}

// ── searchReplace ────────────────────────────────────────────────────────────

export interface SearchReplaceOptions {
  search: string;
  replace: string;
  regex?: boolean;
  preview?: boolean;
  paths?: string[];
}

export interface SearchReplaceMatch {
  path: string;
  lineNumber: number;
  original: string;
  replaced: string;
}

export function searchReplace(
  vault: Vault,
  db: Database,
  options: SearchReplaceOptions,
): SearchReplaceMatch[] {
  const { search, replace, regex = false, preview = false, paths } = options;

  const notes: NoteRow[] = db.getAllNotes();
  const targetPaths = paths ? new Set(paths) : null;

  const pattern = regex ? new RegExp(search, "g") : null;

  const matches: SearchReplaceMatch[] = [];

  for (const note of notes) {
    if (targetPaths && !targetPaths.has(note.path)) continue;

    const content = note.content;
    const lines = content.split("\n");
    let fileChanged = false;
    const newLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let newLine: string;

      if (regex && pattern) {
        // Reset lastIndex for global regex
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          pattern.lastIndex = 0;
          newLine = line.replace(pattern, replace);
          matches.push({
            path: note.path,
            lineNumber: i + 1,
            original: line,
            replaced: newLine,
          });
          fileChanged = true;
        } else {
          newLine = line;
        }
      } else {
        if (line.includes(search)) {
          newLine = line.split(search).join(replace);
          matches.push({
            path: note.path,
            lineNumber: i + 1,
            original: line,
            replaced: newLine,
          });
          fileChanged = true;
        } else {
          newLine = line;
        }
      }
      newLines.push(newLine);
    }

    if (!preview && fileChanged) {
      // Read actual file to preserve frontmatter and full content
      const fileContent = vault.readFile(note.path);
      const fileLines = fileContent.split("\n");
      const updatedLines: string[] = [];

      for (let i = 0; i < fileLines.length; i++) {
        const line = fileLines[i];
        let newLine: string;
        if (regex && pattern) {
          pattern.lastIndex = 0;
          newLine = line.replace(pattern, replace);
        } else {
          newLine = line.includes(search) ? line.split(search).join(replace) : line;
        }
        updatedLines.push(newLine);
      }

      vault.writeFile(note.path, updatedLines.join("\n"));
    }
  }

  return matches;
}

// ── searchByDate ─────────────────────────────────────────────────────────────

export type DateField = "created" | "modified";

export interface SearchByDateOptions {
  after?: string;
  before?: string;
  field?: DateField;
}

export interface SearchByDateResult {
  path: string;
  created: string;
  modified: string;
}

export function searchByDate(
  db: Database,
  options: SearchByDateOptions,
): SearchByDateResult[] {
  const { after, before, field = "modified" } = options;

  const conditions: string[] = [];
  const params: string[] = [];

  if (after) {
    conditions.push(`${field} > ?`);
    params.push(after);
  }
  if (before) {
    conditions.push(`${field} < ?`);
    params.push(before);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT path, created, modified FROM notes ${where} ORDER BY ${field} DESC`;

  const rows = db.raw.prepare(sql).all(...params) as SearchByDateResult[];
  return rows;
}

// ── searchByFrontmatter ──────────────────────────────────────────────────────

export interface SearchByFrontmatterOptions {
  field: string;
  value?: string;
  exists?: boolean;
}

export interface SearchByFrontmatterResult {
  path: string;
  value: unknown;
}

export function searchByFrontmatter(
  db: Database,
  options: SearchByFrontmatterOptions,
): SearchByFrontmatterResult[] {
  const { field, value, exists } = options;

  const jsonPath = `$.${field}`;

  if (exists === false) {
    // Notes where the field does NOT exist
    const sql = `
      SELECT path, json_extract(frontmatter_json, ?) as value
      FROM notes
      WHERE json_extract(frontmatter_json, ?) IS NULL
      ORDER BY path
    `;
    const rows = db.raw.prepare(sql).all(jsonPath, jsonPath) as SearchByFrontmatterResult[];
    return rows;
  }

  if (exists === true && value === undefined) {
    // Notes where the field exists (any value)
    const sql = `
      SELECT path, json_extract(frontmatter_json, ?) as value
      FROM notes
      WHERE json_extract(frontmatter_json, ?) IS NOT NULL
      ORDER BY path
    `;
    const rows = db.raw.prepare(sql).all(jsonPath, jsonPath) as SearchByFrontmatterResult[];
    return rows;
  }

  if (value !== undefined) {
    // Notes where the field equals the given value
    const sql = `
      SELECT path, json_extract(frontmatter_json, ?) as value
      FROM notes
      WHERE json_extract(frontmatter_json, ?) = ?
      ORDER BY path
    `;
    const rows = db.raw
      .prepare(sql)
      .all(jsonPath, jsonPath, value) as SearchByFrontmatterResult[];
    return rows;
  }

  // Default: field exists
  const sql = `
    SELECT path, json_extract(frontmatter_json, ?) as value
    FROM notes
    WHERE json_extract(frontmatter_json, ?) IS NOT NULL
    ORDER BY path
  `;
  const rows = db.raw.prepare(sql).all(jsonPath, jsonPath) as SearchByFrontmatterResult[];
  return rows;
}

// ── searchSimilar ────────────────────────────────────────────────────────────

export interface SearchSimilarOptions {
  path: string;
  limit?: number;
}

export interface SearchSimilarResult {
  path: string;
  score: number;
}

export async function searchSimilar(
  db: Database,
  options: SearchSimilarOptions,
): Promise<SearchSimilarResult[]> {
  const { path, limit = 10 } = options;

  // Check if the target note exists
  const note = db.getNoteByPath(path);
  if (!note) return [];

  // Check if any embeddings exist
  const embeddingCount = (
    db.raw
      .prepare("SELECT COUNT(*) as cnt FROM embeddings WHERE note_id = ?")
      .get(note.id) as { cnt: number }
  ).cnt;

  if (embeddingCount === 0) {
    // No embeddings available — return empty
    return [];
  }

  // If embeddings existed, vector similarity search would go here.
  // For now, return empty as no embedding provider is implemented.
  return [];
}
