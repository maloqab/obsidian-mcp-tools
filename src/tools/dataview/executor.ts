/**
 * DQL Executor — walks a parsed Query AST, resolves sources from the
 * SQLite index, builds per-note contexts, evaluates expressions, and
 * returns a DataviewResult.
 */

import path from "path";
import { Database, NoteRow } from "../../index/sqlite.js";
import { Vault } from "../../core/vault.js";
import { parse } from "./parser.js";
import { FUNCTIONS } from "./functions.js";
import type {
  Query,
  Expr,
  SourceExpr,
  DataviewResult,
  FieldExpr,
  SortExpr,
} from "./types.js";

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Execute a DQL query string against the indexed vault database.
 */
export function executeQuery(
  queryStr: string,
  db: Database,
  vault: Vault,
): DataviewResult {
  const ast = parse(queryStr);
  return executeAST(ast, db, vault);
}

// ── Internal ────────────────────────────────────────────────────────────────

interface NoteContext {
  file: {
    name: string;
    path: string;
    folder: string;
    ext: string;
    size: number;
    ctime: string;
    mtime: string;
    tags: string[];
    inlinks: string[];
    outlinks: string[];
    tasks: { text: string; status: string; line: number }[];
    frontmatter: Record<string, unknown>;
  };
  /** Merged top-level fields from frontmatter + inline fields */
  [key: string]: unknown;
}

function executeAST(
  ast: Query,
  db: Database,
  vault: Vault,
): DataviewResult {
  // 1. Resolve FROM → set of note paths
  const notePaths = resolveSource(ast.from, db);

  // 2. Build contexts
  const contexts = notePaths.map((p) => buildContext(p, db, vault));

  // 3. Evaluate WHERE
  let rows = ast.where
    ? contexts.filter((ctx) => isTruthy(evalExpr(ast.where!, ctx)))
    : contexts;

  // 4. Apply FLATTEN (TABLE, LIST, TASK only)
  if ("flatten" in ast && ast.flatten) {
    for (const flatExpr of ast.flatten) {
      rows = applyFlatten(rows, flatExpr);
    }
  }

  // 5. Apply GROUP BY
  if ("groupBy" in ast && ast.groupBy) {
    rows = applyGroupBy(rows, ast.groupBy);
  }

  // 6. Apply SORT
  if ("sort" in ast && ast.sort) {
    rows = applySort(rows, ast.sort);
  }

  // 7. Apply LIMIT
  if ("limit" in ast && ast.limit !== undefined) {
    rows = rows.slice(0, ast.limit);
  }

  // 8. Format output
  switch (ast.type) {
    case "TABLE":
      return formatTable(rows, ast.fields, ast.withoutId);
    case "LIST":
      return formatList(rows, ast.expression, ast.withoutId);
    case "TASK":
      return formatTask(rows);
    case "CALENDAR":
      return formatCalendar(rows, ast.dateField);
  }
}

// ── Source Resolution ───────────────────────────────────────────────────────

function resolveSource(
  source: SourceExpr | undefined,
  db: Database,
): string[] {
  if (!source) {
    // No FROM — return all notes
    return db.getAllNotes().map((n) => n.path);
  }

  switch (source.kind) {
    case "tag": {
      // Tags in the DB are stored WITHOUT '#' prefix.
      // The lexer stores them WITH '#' (e.g. "#project").
      const tagName = source.tag.startsWith("#")
        ? source.tag.slice(1)
        : source.tag;
      const stmt = db.raw.prepare(
        `SELECT DISTINCT n.path FROM tags t JOIN notes n ON t.note_id = n.id WHERE t.tag = ?`,
      );
      return (stmt.all(tagName) as { path: string }[]).map((r) => r.path);
    }

    case "folder": {
      const folderPrefix = source.path.endsWith("/")
        ? source.path
        : source.path + "/";
      const stmt = db.raw.prepare(
        `SELECT path FROM notes WHERE path LIKE ?`,
      );
      return (stmt.all(folderPrefix + "%") as { path: string }[]).map(
        (r) => r.path,
      );
    }

    case "link": {
      const results = new Set<string>();
      const noteName = source.note;

      if (source.direction === "outgoing" || source.direction === "both") {
        // Find notes that are linked FROM the given note
        const stmt = db.raw.prepare(
          `SELECT l.target_path FROM links l
           JOIN notes n ON l.source_note_id = n.id
           WHERE n.path LIKE ?`,
        );
        const rows = stmt.all(`%${noteName}%`) as { target_path: string }[];
        for (const r of rows) results.add(r.target_path);
      }

      if (source.direction === "incoming" || source.direction === "both") {
        // Find notes that link TO the given note
        const stmt = db.raw.prepare(
          `SELECT n.path FROM links l
           JOIN notes n ON l.source_note_id = n.id
           WHERE l.target_path LIKE ?`,
        );
        const rows = stmt.all(`%${noteName}%`) as { path: string }[];
        for (const r of rows) results.add(r.path);
      }

      return [...results];
    }

    case "binary": {
      const left = new Set(resolveSource(source.left, db));
      const right = new Set(resolveSource(source.right, db));
      if (source.op === "OR") {
        // Union
        for (const p of right) left.add(p);
        return [...left];
      } else {
        // Intersection (AND)
        return [...left].filter((p) => right.has(p));
      }
    }

    case "negated": {
      const allPaths = new Set(
        db.getAllNotes().map((n) => n.path),
      );
      const excluded = resolveSource(source.source, db);
      for (const p of excluded) allPaths.delete(p);
      return [...allPaths];
    }
  }
}

// ── Context Building ────────────────────────────────────────────────────────

function buildContext(
  notePath: string,
  db: Database,
  vault: Vault,
): NoteContext {
  const note = db.getNoteByPath(notePath);
  if (!note) {
    // Shouldn't happen, but guard
    return {
      file: {
        name: path.basename(notePath, ".md"),
        path: notePath,
        folder: path.dirname(notePath),
        ext: path.extname(notePath),
        size: 0,
        ctime: "",
        mtime: "",
        tags: [],
        inlinks: [],
        outlinks: [],
        tasks: [],
        frontmatter: {},
      },
    };
  }

  const frontmatter = safeParseFrontmatter(note.frontmatter_json);
  const tags = getNoteTags(note.id, db);
  const outlinks = getNoteOutlinks(note.id, db);
  const inlinks = getNoteInlinks(notePath, db);
  const tasks = parseTasksFromContent(note.content);
  const inlineFields = getNoteInlineFields(note.id, db);

  const ctx: NoteContext = {
    file: {
      name: path.basename(notePath, ".md"),
      path: notePath,
      folder: path.dirname(notePath) === "." ? "" : path.dirname(notePath),
      ext: path.extname(notePath),
      size: note.content.length,
      ctime: note.created,
      mtime: note.modified,
      tags,
      inlinks,
      outlinks,
      tasks,
      frontmatter,
    },
  };

  // Merge frontmatter keys as top-level fields
  for (const [k, v] of Object.entries(frontmatter)) {
    if (k !== "file") {
      ctx[k] = v;
    }
  }

  // Merge inline fields as top-level fields (inline fields override frontmatter)
  for (const [k, v] of Object.entries(inlineFields)) {
    if (k !== "file") {
      ctx[k] = v;
    }
  }

  return ctx;
}

function safeParseFrontmatter(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getNoteTags(noteId: number, db: Database): string[] {
  const stmt = db.raw.prepare(
    `SELECT tag FROM tags WHERE note_id = ?`,
  );
  return (stmt.all(noteId) as { tag: string }[]).map((r) => r.tag);
}

function getNoteOutlinks(noteId: number, db: Database): string[] {
  const stmt = db.raw.prepare(
    `SELECT target_path FROM links WHERE source_note_id = ?`,
  );
  return (stmt.all(noteId) as { target_path: string }[]).map(
    (r) => r.target_path,
  );
}

function getNoteInlinks(notePath: string, db: Database): string[] {
  const stmt = db.raw.prepare(
    `SELECT DISTINCT n.path FROM links l
     JOIN notes n ON l.source_note_id = n.id
     WHERE l.target_path = ?`,
  );
  // Also check partial path matches (wikilinks may store just the note name)
  const baseName = path.basename(notePath, ".md");
  const exact = (stmt.all(notePath) as { path: string }[]).map(
    (r) => r.path,
  );
  const byName = (stmt.all(baseName) as { path: string }[]).map(
    (r) => r.path,
  );
  const combined = new Set([...exact, ...byName]);
  return [...combined];
}

function getNoteInlineFields(
  noteId: number,
  db: Database,
): Record<string, unknown> {
  const stmt = db.raw.prepare(
    `SELECT key, value, type FROM inline_fields WHERE note_id = ?`,
  );
  const rows = stmt.all(noteId) as {
    key: string;
    value: string | null;
    type: string;
  }[];

  const fields: Record<string, unknown> = {};
  for (const row of rows) {
    fields[row.key] = coerceFieldValue(row.value, row.type);
  }
  return fields;
}

function coerceFieldValue(
  value: string | null,
  type: string,
): unknown {
  if (value === null) return null;
  switch (type) {
    case "number":
      return Number(value) || 0;
    case "boolean":
      return value === "true";
    case "list":
      try {
        return JSON.parse(value);
      } catch {
        return value.split(",").map((s) => s.trim());
      }
    case "date":
      return value;
    default:
      return value;
  }
}

function parseTasksFromContent(
  content: string,
): { text: string; status: string; line: number }[] {
  const tasks: { text: string; status: string; line: number }[] = [];
  const RE_TASK = /^- \[([ xX/\-])\] (.+)$/gm;
  const lines = content.split("\n");

  let lineNum = 1;
  for (const line of lines) {
    RE_TASK.lastIndex = 0;
    const m = RE_TASK.exec(line);
    if (m) {
      const marker = m[1];
      let status: string;
      switch (marker) {
        case "x":
        case "X":
          status = "complete";
          break;
        case "/":
          status = "in-progress";
          break;
        case "-":
          status = "cancelled";
          break;
        default:
          status = "incomplete";
          break;
      }
      tasks.push({ text: m[2], status, line: lineNum });
    }
    lineNum++;
  }
  return tasks;
}

// ── Expression Evaluation ───────────────────────────────────────────────────

function evalExpr(expr: Expr, ctx: NoteContext): unknown {
  switch (expr.kind) {
    case "literal":
      return expr.value;

    case "identifier":
      return resolveIdentifier(expr.name, ctx);

    case "fieldAccess":
      return resolveFieldAccess(expr.object, expr.field, ctx);

    case "binary":
      return evalBinaryExpr(expr.op, expr.left, expr.right, ctx);

    case "unary":
      return evalUnaryExpr(expr.op, expr.operand, ctx);

    case "functionCall":
      return evalFunctionCall(expr.name, expr.args, ctx);

    case "list":
      return expr.items.map((item) => evalExpr(item, ctx));
  }
}

function resolveIdentifier(name: string, ctx: NoteContext): unknown {
  // Check top-level context keys first (inline fields + frontmatter)
  if (name in ctx && name !== "file") {
    return ctx[name];
  }

  // Check 'file' as a special identifier
  if (name === "file") {
    return ctx.file;
  }

  return undefined;
}

function resolveFieldAccess(
  objectExpr: Expr,
  field: string,
  ctx: NoteContext,
): unknown {
  const obj = evalExpr(objectExpr, ctx);
  if (obj === null || obj === undefined) return undefined;

  if (typeof obj === "object" && !Array.isArray(obj)) {
    return (obj as Record<string, unknown>)[field];
  }

  // Array field access (e.g. for array.length)
  if (Array.isArray(obj) && field === "length") {
    return obj.length;
  }

  return undefined;
}

function evalBinaryExpr(
  op: string,
  leftExpr: Expr,
  rightExpr: Expr,
  ctx: NoteContext,
): unknown {
  // Short-circuit for AND/OR
  if (op === "AND") {
    const left = evalExpr(leftExpr, ctx);
    if (!isTruthy(left)) return false;
    return isTruthy(evalExpr(rightExpr, ctx));
  }
  if (op === "OR") {
    const left = evalExpr(leftExpr, ctx);
    if (isTruthy(left)) return true;
    return isTruthy(evalExpr(rightExpr, ctx));
  }

  const left = evalExpr(leftExpr, ctx);
  const right = evalExpr(rightExpr, ctx);

  switch (op) {
    case "=":
      return looseEquals(left, right);
    case "!=":
      return !looseEquals(left, right);
    case "<":
      return compare(left, right) < 0;
    case ">":
      return compare(left, right) > 0;
    case "<=":
      return compare(left, right) <= 0;
    case ">=":
      return compare(left, right) >= 0;
    case "+":
      if (typeof left === "number" && typeof right === "number")
        return left + right;
      return String(left ?? "") + String(right ?? "");
    case "-":
      return (Number(left) || 0) - (Number(right) || 0);
    case "*":
      return (Number(left) || 0) * (Number(right) || 0);
    case "/": {
      const divisor = Number(right) || 0;
      return divisor === 0 ? 0 : (Number(left) || 0) / divisor;
    }
    default:
      return undefined;
  }
}

function evalUnaryExpr(
  op: string,
  operandExpr: Expr,
  ctx: NoteContext,
): unknown {
  const val = evalExpr(operandExpr, ctx);
  switch (op) {
    case "NOT":
    case "!":
      return !isTruthy(val);
    case "-":
      return -(Number(val) || 0);
    default:
      return undefined;
  }
}

function evalFunctionCall(
  name: string,
  args: Expr[],
  ctx: NoteContext,
): unknown {
  const fn = FUNCTIONS[name.toLowerCase()];
  if (!fn) return undefined;

  const evaluatedArgs = args.map((a) => evalExpr(a, ctx));
  return fn(...evaluatedArgs);
}

// ── Comparison Helpers ──────────────────────────────────────────────────────

function isTruthy(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") return val !== "";
  if (Array.isArray(val)) return val.length > 0;
  return true;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  // Compare numbers
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function compare(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;

  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }

  // Try numeric comparison if both can be numbers
  const numA = Number(a);
  const numB = Number(b);
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB;
  }

  return String(a).localeCompare(String(b));
}

// ── FLATTEN ─────────────────────────────────────────────────────────────────

function applyFlatten(
  rows: NoteContext[],
  flatExpr: Expr,
): NoteContext[] {
  const result: NoteContext[] = [];
  for (const ctx of rows) {
    const val = evalExpr(flatExpr, ctx);
    if (Array.isArray(val)) {
      for (const item of val) {
        // Create a copy of the context with the flattened value
        const copy: NoteContext = { ...ctx, file: { ...ctx.file } };
        // Set the flattened field identifier to the item
        if (flatExpr.kind === "identifier") {
          (copy as Record<string, unknown>)[flatExpr.name] = item;
        } else if (flatExpr.kind === "fieldAccess") {
          // For field access like file.tags, we just add the individual item
          (copy as Record<string, unknown>)[getExprName(flatExpr)] = item;
        }
        result.push(copy);
      }
    } else {
      result.push(ctx);
    }
  }
  return result;
}

function getExprName(expr: Expr): string {
  if (expr.kind === "identifier") return expr.name;
  if (expr.kind === "fieldAccess") {
    return getExprName(expr.object) + "." + expr.field;
  }
  return "value";
}

// ── GROUP BY ────────────────────────────────────────────────────────────────

function applyGroupBy(
  rows: NoteContext[],
  groupExpr: Expr,
): NoteContext[] {
  const groups = new Map<string, NoteContext[]>();
  for (const ctx of rows) {
    const key = String(evalExpr(groupExpr, ctx) ?? "null");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ctx);
  }

  // Return one context per group with a `rows` field
  const result: NoteContext[] = [];
  for (const [key, groupRows] of groups) {
    const first = groupRows[0];
    const grouped: NoteContext = {
      ...first,
      file: { ...first.file },
      key,
      rows: groupRows,
    };
    result.push(grouped);
  }
  return result;
}

// ── SORT ────────────────────────────────────────────────────────────────────

function applySort(
  rows: NoteContext[],
  sorts: SortExpr[],
): NoteContext[] {
  return [...rows].sort((a, b) => {
    for (const s of sorts) {
      const aVal = evalExpr(s.expr, a);
      const bVal = evalExpr(s.expr, b);
      const cmp = compare(aVal, bVal);
      if (cmp !== 0) {
        return s.direction === "desc" ? -cmp : cmp;
      }
    }
    return 0;
  });
}

// ── Output Formatting ───────────────────────────────────────────────────────

function formatTable(
  rows: NoteContext[],
  fields: FieldExpr[],
  withoutId: boolean,
): DataviewResult {
  const headers: string[] = [];
  if (!withoutId) headers.push("File");

  for (const f of fields) {
    headers.push(f.alias ?? getExprName(f.expr));
  }

  const resultRows: Record<string, unknown>[] = rows.map((ctx) => {
    const row: Record<string, unknown> = {};
    if (!withoutId) {
      row["File"] = ctx.file.path;
    }
    for (const f of fields) {
      const key = f.alias ?? getExprName(f.expr);
      row[key] = evalExpr(f.expr, ctx);
    }
    return row;
  });

  return {
    type: "TABLE",
    headers,
    rows: resultRows,
  };
}

function formatList(
  rows: NoteContext[],
  expression: Expr | undefined,
  withoutId: boolean,
): DataviewResult {
  const items = rows.map((ctx) => {
    if (expression) {
      const val = evalExpr(expression, ctx);
      if (withoutId) return val;
      return `${ctx.file.path}: ${val}`;
    }
    return withoutId ? ctx.file.name : ctx.file.path;
  });

  return {
    type: "LIST",
    items,
  };
}

function formatTask(rows: NoteContext[]): DataviewResult {
  const tasks: { text: string; status: string; path: string; line: number }[] =
    [];
  for (const ctx of rows) {
    for (const task of ctx.file.tasks) {
      tasks.push({
        text: task.text,
        status: task.status,
        path: ctx.file.path,
        line: task.line,
      });
    }
  }

  return {
    type: "TASK",
    tasks,
  };
}

function formatCalendar(
  rows: NoteContext[],
  dateField: Expr,
): DataviewResult {
  const calendar: { date: string; path: string }[] = [];
  for (const ctx of rows) {
    const dateVal = evalExpr(dateField, ctx);
    if (dateVal !== undefined && dateVal !== null) {
      calendar.push({
        date: String(dateVal),
        path: ctx.file.path,
      });
    }
  }

  return {
    type: "CALENDAR",
    calendar,
  };
}
