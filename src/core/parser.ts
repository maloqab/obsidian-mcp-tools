import matter from "gray-matter";
import type { ParsedNote, Link, Tag, InlineField, Task } from "./types.js";

// Regex: wikilinks (not preceded by !) - captures target and optional alias
const RE_WIKI = /(?<!!)\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;
// Regex: embeds ![[...]]
const RE_EMBED = /!\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;
// Regex: markdown links [text](url) - not preceded by !
const RE_MD_LINK = /(?<!!)\[([^\]]*?)\]\(([^)]+?)\)/g;
// Regex: inline tags #tag (word boundary on left via lookbehind)
const RE_INLINE_TAG = /(?<=\s|^)#([a-zA-Z0-9_/\u00C0-\u024F-]+)/gm;
// Regex: inline Dataview fields  key:: value
const RE_INLINE_FIELD = /^([a-zA-Z_][a-zA-Z0-9_]*):: (.+)$/gm;
// Regex: tasks
const RE_TASK = /^- \[([ xX/\-])\] (.+)$/gm;
// Regex: date YYYY-MM-DD
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function inferFieldValue(raw: string): { value: unknown; type: InlineField["type"] } {
  const trimmed = raw.trim();

  // Boolean
  if (trimmed === "true") return { value: true, type: "boolean" };
  if (trimmed === "false") return { value: false, type: "boolean" };

  // Number
  const num = Number(trimmed);
  if (trimmed !== "" && !isNaN(num)) return { value: num, type: "number" };

  // Date YYYY-MM-DD
  if (RE_DATE.test(trimmed)) return { value: trimmed, type: "date" };

  // List: comma-separated (at least one comma)
  if (trimmed.includes(",")) {
    const items = trimmed.split(",").map((s) => s.trim());
    return { value: items, type: "list" };
  }

  return { value: trimmed, type: "string" };
}

function taskStatus(marker: string): Task["status"] {
  switch (marker) {
    case "x":
    case "X":
      return "complete";
    case "/":
      return "in-progress";
    case "-":
      return "cancelled";
    default:
      return "incomplete";
  }
}

export function parseNote(filePath: string, rawContent: string): ParsedNote {
  // --- Frontmatter ---
  let frontmatter: Record<string, unknown> = {};
  let body = rawContent;

  if (rawContent.trim() !== "") {
    const parsed = matter(rawContent);
    frontmatter = parsed.data as Record<string, unknown>;
    body = parsed.content;
  }

  const links: Link[] = [];
  const tags: Tag[] = [];
  const inlineFields: InlineField[] = [];
  const tasks: Task[] = [];

  // Build a line-number index: map character offset -> line number (1-based)
  // We'll use the full raw content for line mapping so positions match
  const lines = rawContent.split("\n");
  // Precompute cumulative offsets per line in rawContent
  const lineOffsets: number[] = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineOffsets[i] = offset;
    offset += lines[i].length + 1; // +1 for \n
  }

  function lineOf(index: number): number {
    // binary search for the line containing character index
    let lo = 0;
    let hi = lineOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineOffsets[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1; // 1-based
  }

  // --- Embeds (must run before wiki so ![[]] is excluded from wiki matches) ---
  {
    let m: RegExpExecArray | null;
    RE_EMBED.lastIndex = 0;
    while ((m = RE_EMBED.exec(rawContent)) !== null) {
      const raw = m[1].trim();
      // Split on # for anchor
      const hashIdx = raw.indexOf("#");
      const targetPath = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
      const anchor = hashIdx === -1 ? undefined : raw.slice(hashIdx + 1);
      const link: Link = {
        sourcePath: filePath,
        targetPath,
        type: "embed",
        line: lineOf(m.index),
      };
      if (anchor) link.anchor = anchor;
      if (m[2] !== undefined) link.displayText = m[2];
      links.push(link);
    }
  }

  // --- Wikilinks ---
  {
    let m: RegExpExecArray | null;
    RE_WIKI.lastIndex = 0;
    while ((m = RE_WIKI.exec(rawContent)) !== null) {
      const raw = m[1].trim();
      const hashIdx = raw.indexOf("#");
      const targetPath = hashIdx === -1 ? raw : raw.slice(0, hashIdx);
      const anchor = hashIdx === -1 ? undefined : raw.slice(hashIdx + 1);
      const link: Link = {
        sourcePath: filePath,
        targetPath,
        type: "wiki",
        line: lineOf(m.index),
      };
      if (anchor) link.anchor = anchor;
      if (m[2] !== undefined) link.displayText = m[2];
      links.push(link);
    }
  }

  // --- Markdown links (skip http/https URLs) ---
  {
    let m: RegExpExecArray | null;
    RE_MD_LINK.lastIndex = 0;
    while ((m = RE_MD_LINK.exec(rawContent)) !== null) {
      const url = m[2].trim();
      if (url.startsWith("http://") || url.startsWith("https://")) continue;
      const link: Link = {
        sourcePath: filePath,
        targetPath: url,
        type: "markdown",
        line: lineOf(m.index),
      };
      if (m[1]) link.displayText = m[1];
      links.push(link);
    }
  }

  // --- Frontmatter tags ---
  {
    const fmTags = frontmatter.tags;
    if (Array.isArray(fmTags)) {
      for (const t of fmTags) {
        if (typeof t === "string") {
          tags.push({ name: t, source: "frontmatter" });
        }
      }
    } else if (typeof fmTags === "string") {
      tags.push({ name: fmTags, source: "frontmatter" });
    }
  }

  // --- Inline tags (from body, skip frontmatter block) ---
  {
    // Find where body starts in rawContent
    const bodyStart = rawContent.indexOf(body);
    let m: RegExpExecArray | null;
    RE_INLINE_TAG.lastIndex = 0;
    while ((m = RE_INLINE_TAG.exec(rawContent)) !== null) {
      // Only consider tags in the body (after frontmatter)
      if (m.index < bodyStart) continue;
      tags.push({
        name: m[1],
        source: "inline",
        line: lineOf(m.index),
      });
    }
  }

  // --- Inline fields (from body only) ---
  {
    const bodyStart = rawContent.indexOf(body);
    let m: RegExpExecArray | null;
    RE_INLINE_FIELD.lastIndex = 0;
    while ((m = RE_INLINE_FIELD.exec(rawContent)) !== null) {
      if (m.index < bodyStart) continue;
      const { value, type } = inferFieldValue(m[2]);
      inlineFields.push({
        key: m[1],
        value,
        type,
        line: lineOf(m.index),
      });
    }
  }

  // --- Tasks (from body only) ---
  {
    const bodyStart = rawContent.indexOf(body);
    let m: RegExpExecArray | null;
    RE_TASK.lastIndex = 0;
    while ((m = RE_TASK.exec(rawContent)) !== null) {
      if (m.index < bodyStart) continue;
      tasks.push({
        text: m[2],
        status: taskStatus(m[1]),
        line: lineOf(m.index),
        tags: [],
      });
    }
  }

  return {
    path: filePath,
    content: rawContent,
    frontmatter,
    links,
    tags,
    inlineFields,
    tasks,
  };
}
