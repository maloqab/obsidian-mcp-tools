import { describe, it, expect } from "vitest";
import { NoteSchema, LinkSchema, InlineFieldSchema } from "../../src/core/types.js";

describe("NoteSchema", () => {
  it("validates a complete note", () => {
    const result = NoteSchema.safeParse({
      path: "Projects/Alpha.md",
      content: "# Alpha\nSome content",
      frontmatter: { title: "Alpha", tags: ["project"] },
      links: [],
      tags: ["project"],
      inlineFields: [],
      tasks: [],
      checksum: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects note without path", () => {
    const result = NoteSchema.safeParse({ content: "# Test" });
    expect(result.success).toBe(false);
  });
});

describe("LinkSchema", () => {
  it("validates a wikilink", () => {
    const result = LinkSchema.safeParse({
      sourcePath: "Welcome.md",
      targetPath: "Projects/Alpha",
      type: "wiki",
      line: 5,
      displayText: undefined,
    });
    expect(result.success).toBe(true);
  });

  it("validates an embed", () => {
    const result = LinkSchema.safeParse({
      sourcePath: "Projects/Beta.md",
      targetPath: "Projects/Alpha",
      type: "embed",
      line: 10,
      anchor: "Tasks",
    });
    expect(result.success).toBe(true);
  });
});

describe("InlineFieldSchema", () => {
  it("validates a string field", () => {
    const result = InlineFieldSchema.safeParse({
      key: "category",
      value: "engineering",
      type: "string",
      line: 15,
    });
    expect(result.success).toBe(true);
  });

  it("validates a number field", () => {
    const result = InlineFieldSchema.safeParse({
      key: "rating",
      value: 5,
      type: "number",
      line: 14,
    });
    expect(result.success).toBe(true);
  });
});
