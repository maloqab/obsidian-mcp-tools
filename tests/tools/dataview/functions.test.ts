import { describe, it, expect } from "vitest";
import { FUNCTIONS } from "../../../src/tools/dataview/functions.js";

describe("DQL Functions", () => {
  // ── String Functions ────────────────────────────────────────────────────

  it("contains checks string inclusion", () => {
    expect(FUNCTIONS.contains("hello world", "world")).toBe(true);
    expect(FUNCTIONS.contains("hello world", "xyz")).toBe(false);
  });

  it("startswith checks string prefix", () => {
    expect(FUNCTIONS.startswith("hello world", "hello")).toBe(true);
    expect(FUNCTIONS.startswith("hello world", "world")).toBe(false);
  });

  it("endswith checks string suffix", () => {
    expect(FUNCTIONS.endswith("hello world", "world")).toBe(true);
    expect(FUNCTIONS.endswith("hello world", "hello")).toBe(false);
  });

  it("replace replaces all occurrences", () => {
    expect(FUNCTIONS.replace("aabbcc", "b", "x")).toBe("aaxxcc");
  });

  it("lower and upper transform strings", () => {
    expect(FUNCTIONS.lower("HELLO")).toBe("hello");
    expect(FUNCTIONS.upper("hello")).toBe("HELLO");
  });

  it("length works on strings and arrays", () => {
    expect(FUNCTIONS.length("hello")).toBe(5);
    expect(FUNCTIONS.length([1, 2, 3])).toBe(3);
  });

  it("regexmatch tests pattern", () => {
    expect(FUNCTIONS.regexmatch("hello-123", "\\d+")).toBe(true);
    expect(FUNCTIONS.regexmatch("hello", "\\d+")).toBe(false);
  });

  it("regexreplace replaces via regex", () => {
    expect(FUNCTIONS.regexreplace("hello 123 world 456", "\\d+", "X")).toBe(
      "hello X world X",
    );
  });

  // ── List Functions ──────────────────────────────────────────────────────

  it("join concatenates array", () => {
    expect(FUNCTIONS.join(["a", "b", "c"], ", ")).toBe("a, b, c");
  });

  it("join on non-array returns string", () => {
    expect(FUNCTIONS.join("hello", ", ")).toBe("hello");
  });

  it("sort returns sorted copy", () => {
    const arr = [3, 1, 2];
    expect(FUNCTIONS.sort(arr)).toEqual([1, 2, 3]);
    expect(arr).toEqual([3, 1, 2]); // original unchanged
  });

  it("reverse returns reversed copy", () => {
    expect(FUNCTIONS.reverse([1, 2, 3])).toEqual([3, 2, 1]);
  });

  it("flat flattens nested arrays", () => {
    expect(FUNCTIONS.flat([[1, 2], [3, 4]])).toEqual([1, 2, 3, 4]);
  });

  it("any checks if any element is truthy", () => {
    expect(FUNCTIONS.any([0, false, 1], null)).toBe(true);
    expect(FUNCTIONS.any([0, false, ""], null)).toBe(false);
  });

  it("all checks if all elements are truthy", () => {
    expect(FUNCTIONS.all([1, true, "a"], null)).toBe(true);
    expect(FUNCTIONS.all([1, true, 0], null)).toBe(false);
  });

  // ── Math Functions ──────────────────────────────────────────────────────

  it("min finds minimum", () => {
    expect(FUNCTIONS.min(3, 1, 2)).toBe(1);
  });

  it("max finds maximum", () => {
    expect(FUNCTIONS.max(3, 1, 2)).toBe(3);
  });

  it("sum adds array elements", () => {
    expect(FUNCTIONS.sum([1, 2, 3])).toBe(6);
  });

  it("sum handles non-numeric values", () => {
    expect(FUNCTIONS.sum([1, "foo", 3])).toBe(4);
  });

  it("round works with decimals", () => {
    expect(FUNCTIONS.round(3.14159, 2)).toBe(3.14);
  });

  it("round works without decimals", () => {
    expect(FUNCTIONS.round(3.7)).toBe(4);
  });

  it("average computes mean", () => {
    expect(FUNCTIONS.average([2, 4, 6])).toBe(4);
  });

  it("average returns 0 for empty array", () => {
    expect(FUNCTIONS.average([])).toBe(0);
  });

  // ── Utility Functions ─────────────────────────────────────────────────

  it("default provides fallback", () => {
    expect(FUNCTIONS.default(null, "fallback")).toBe("fallback");
    expect(FUNCTIONS.default(undefined, "fallback")).toBe("fallback");
    expect(FUNCTIONS.default("value", "fallback")).toBe("value");
  });

  it("choice selects based on condition", () => {
    expect(FUNCTIONS.choice(true, "yes", "no")).toBe("yes");
    expect(FUNCTIONS.choice(false, "yes", "no")).toBe("no");
  });

  it("typeof returns correct types", () => {
    expect(FUNCTIONS.typeof(null)).toBe("null");
    expect(FUNCTIONS.typeof(undefined)).toBe("null");
    expect(FUNCTIONS.typeof(42)).toBe("number");
    expect(FUNCTIONS.typeof("hi")).toBe("string");
    expect(FUNCTIONS.typeof([1])).toBe("array");
    expect(FUNCTIONS.typeof(true)).toBe("boolean");
  });

  it("number coerces to number", () => {
    expect(FUNCTIONS.number("42")).toBe(42);
    expect(FUNCTIONS.number("abc")).toBe(0);
  });

  it("string coerces to string", () => {
    expect(FUNCTIONS.string(42)).toBe("42");
    expect(FUNCTIONS.string(null)).toBe("");
  });

  it("link creates a link object", () => {
    expect(FUNCTIONS.link("Notes/Foo")).toEqual({
      path: "Notes/Foo",
      display: undefined,
    });
    expect(FUNCTIONS.link("Notes/Foo", "Foo")).toEqual({
      path: "Notes/Foo",
      display: "Foo",
    });
  });

  // ── Null Safety ───────────────────────────────────────────────────────

  it("string functions handle null/undefined gracefully", () => {
    expect(FUNCTIONS.contains(null, "x")).toBe(false);
    expect(FUNCTIONS.lower(undefined)).toBe("");
    expect(FUNCTIONS.upper(null)).toBe("");
    expect(FUNCTIONS.length(null)).toBe(0);
  });
});
