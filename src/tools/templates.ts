import path from "path";
import { Vault } from "../core/vault.js";
import { Indexer } from "../index/indexer.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return today's date as YYYY-MM-DD. */
function todayDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Return current time as HH:MM. */
function currentTime(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Replace all `{{key}}` placeholders in content with values from vars. */
function substituteVariables(content: string, vars: Record<string, string>): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match;
  });
}

// ── Exported tool functions ───────────────────────────────────────────────────

/**
 * List all .md files inside `templateFolder` (relative to the vault root).
 * Returns an array of relative vault paths.
 */
export function listTemplates(vault: Vault, templateFolder: string): string[] {
  return vault
    .listMarkdownFiles()
    .filter((f) => f.startsWith(templateFolder + "/") || f.startsWith(templateFolder + "\\"));
}

// ────────────────────────────────────────────────────────────────────────────

export interface ApplyTemplateOptions {
  template: string;
  targetPath: string;
  variables: Record<string, string>;
}

/**
 * Read the template at `opts.template`, substitute all `{{key}}` placeholders
 * (user-supplied variables + auto-variables: date, time, title), write the
 * result to `opts.targetPath`, and index the new file.
 */
export function applyTemplate(
  vault: Vault,
  indexer: Indexer,
  opts: ApplyTemplateOptions
): void {
  if (!vault.exists(opts.template)) {
    throw new Error(`Template not found: ${opts.template}`);
  }

  // Derive title from the target filename (basename without .md)
  const basename = path.basename(opts.targetPath);
  const titleFromPath = basename.endsWith(".md") ? basename.slice(0, -3) : basename;

  // Build the full variable map: auto-vars first, then user-supplied (user wins)
  const vars: Record<string, string> = {
    date: todayDate(),
    time: currentTime(),
    title: titleFromPath,
    ...opts.variables,
  };

  const raw = vault.readFile(opts.template);
  const rendered = substituteVariables(raw, vars);

  vault.writeFile(opts.targetPath, rendered);
  indexer.indexSingleFile(opts.targetPath);
}

// ────────────────────────────────────────────────────────────────────────────

export interface CreateTemplateOptions {
  path: string;
  content: string;
}

/**
 * Write a new template file to `opts.path`. No indexing is performed — templates
 * are source files only.
 */
export function createTemplate(vault: Vault, opts: CreateTemplateOptions): void {
  vault.writeFile(opts.path, opts.content);
}
