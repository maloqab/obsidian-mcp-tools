/**
 * Built-in Dataview function registry.
 *
 * Each function accepts `unknown` arguments and returns `unknown`,
 * mirroring the loosely-typed nature of Dataview expressions.
 */

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  // ── String ────────────────────────────────────────────────────────────────

  contains: (a: unknown, b: unknown) =>
    String(a ?? "").includes(String(b ?? "")),

  startswith: (a: unknown, b: unknown) =>
    String(a ?? "").startsWith(String(b ?? "")),

  endswith: (a: unknown, b: unknown) =>
    String(a ?? "").endsWith(String(b ?? "")),

  replace: (s: unknown, from: unknown, to: unknown) =>
    String(s ?? "").replace(
      new RegExp(escapeRegex(String(from)), "g"),
      String(to),
    ),

  lower: (s: unknown) => String(s ?? "").toLowerCase(),

  upper: (s: unknown) => String(s ?? "").toUpperCase(),

  length: (a: unknown) =>
    Array.isArray(a) ? a.length : String(a ?? "").length,

  regexmatch: (s: unknown, pattern: unknown) =>
    new RegExp(String(pattern)).test(String(s ?? "")),

  regexreplace: (s: unknown, pattern: unknown, replacement: unknown) =>
    String(s ?? "").replace(
      new RegExp(String(pattern), "g"),
      String(replacement),
    ),

  // ── List ──────────────────────────────────────────────────────────────────

  join: (arr: unknown, sep: unknown) =>
    Array.isArray(arr) ? arr.join(String(sep ?? ", ")) : String(arr),

  sort: (arr: unknown) =>
    Array.isArray(arr) ? [...arr].sort() : arr,

  reverse: (arr: unknown) =>
    Array.isArray(arr) ? [...arr].reverse() : arr,

  flat: (arr: unknown) =>
    Array.isArray(arr) ? arr.flat() : arr,

  any: (arr: unknown, _fn: unknown) =>
    Array.isArray(arr) ? arr.some((v) => !!v) : false,

  all: (arr: unknown, _fn: unknown) =>
    Array.isArray(arr) ? arr.every((v) => !!v) : false,

  // ── Math ──────────────────────────────────────────────────────────────────

  min: (...args: unknown[]) =>
    Math.min(
      ...(args.flat().filter((x) => typeof x === "number") as number[]),
    ),

  max: (...args: unknown[]) =>
    Math.max(
      ...(args.flat().filter((x) => typeof x === "number") as number[]),
    ),

  sum: (arr: unknown) =>
    Array.isArray(arr)
      ? arr.reduce((a: number, b: unknown) => a + (Number(b) || 0), 0)
      : 0,

  round: (n: unknown, decimals?: unknown) => {
    const factor = 10 ** (Number(decimals) || 0);
    return Math.round(Number(n) * factor) / factor;
  },

  average: (arr: unknown) => {
    if (!Array.isArray(arr) || arr.length === 0) return 0;
    const nums = arr.filter((x) => typeof x === "number") as number[];
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  },

  // ── Utility ───────────────────────────────────────────────────────────────

  default: (val: unknown, def: unknown) => val ?? def,

  choice: (cond: unknown, ifTrue: unknown, ifFalse: unknown) =>
    cond ? ifTrue : ifFalse,

  typeof: (val: unknown) => {
    if (val === null || val === undefined) return "null";
    if (Array.isArray(val)) return "array";
    return typeof val;
  },

  number: (val: unknown) => Number(val) || 0,

  string: (val: unknown) => String(val ?? ""),

  link: (pathArg: unknown, display?: unknown) => ({
    path: String(pathArg),
    display: display ? String(display) : undefined,
  }),

  date: (s: unknown) => String(s),

  dateformat: (_d: unknown, _fmt: unknown) => String(_d), // simplified
};
