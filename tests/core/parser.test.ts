import { describe, it, expect } from "vitest";
import { parseNote } from "../../src/core/parser.js";

const SAMPLE_NOTE = `---
title: Test Note
tags: [project, active]
---

# Test Note

This links to [[Other Note]] and [[Folder/Deep Note|aliased]].

Also a [markdown link](some-file.md) and an embed ![[Image.png]].

## Section with heading link to [[Welcome]]

rating:: 5
category:: engineering
due:: 2025-06-01

- [ ] Incomplete task
- [x] Complete task #todo
- [/] In-progress task
- [-] Cancelled task

Some #inline-tag and #nested/tag/here text.
`;

describe("parseNote", () => {
  it("extracts frontmatter", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    expect(result.frontmatter.title).toBe("Test Note");
    expect(result.frontmatter.tags).toEqual(["project", "active"]);
  });

  it("extracts wikilinks", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    const wikiLinks = result.links.filter((l) => l.type === "wiki");
    expect(wikiLinks).toHaveLength(3);
    expect(wikiLinks[0].targetPath).toBe("Other Note");
    expect(wikiLinks[1].targetPath).toBe("Folder/Deep Note");
    expect(wikiLinks[1].displayText).toBe("aliased");
    expect(wikiLinks[2].targetPath).toBe("Welcome");
  });

  it("extracts markdown links", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    const mdLinks = result.links.filter((l) => l.type === "markdown");
    expect(mdLinks).toHaveLength(1);
    expect(mdLinks[0].targetPath).toBe("some-file.md");
  });

  it("extracts embeds", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    const embeds = result.links.filter((l) => l.type === "embed");
    expect(embeds).toHaveLength(1);
    expect(embeds[0].targetPath).toBe("Image.png");
  });

  it("extracts frontmatter tags", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    const fmTags = result.tags.filter((t) => t.source === "frontmatter");
    expect(fmTags.map((t) => t.name)).toEqual(["project", "active"]);
  });

  it("extracts inline tags", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    const inlineTags = result.tags.filter((t) => t.source === "inline");
    const names = inlineTags.map((t) => t.name);
    expect(names).toContain("todo");
    expect(names).toContain("inline-tag");
    expect(names).toContain("nested/tag/here");
  });

  it("extracts inline fields", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    expect(result.inlineFields).toHaveLength(3);
    const rating = result.inlineFields.find((f) => f.key === "rating");
    expect(rating?.value).toBe(5);
    expect(rating?.type).toBe("number");
    const category = result.inlineFields.find((f) => f.key === "category");
    expect(category?.value).toBe("engineering");
    expect(category?.type).toBe("string");
    const due = result.inlineFields.find((f) => f.key === "due");
    expect(due?.type).toBe("date");
  });

  it("extracts tasks", () => {
    const result = parseNote("test.md", SAMPLE_NOTE);
    expect(result.tasks).toHaveLength(4);
    expect(result.tasks[0].status).toBe("incomplete");
    expect(result.tasks[0].text).toBe("Incomplete task");
    expect(result.tasks[1].status).toBe("complete");
    expect(result.tasks[1].text).toBe("Complete task #todo");
    expect(result.tasks[2].status).toBe("in-progress");
    expect(result.tasks[3].status).toBe("cancelled");
  });

  it("handles empty content", () => {
    const result = parseNote("empty.md", "");
    expect(result.links).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.frontmatter).toEqual({});
  });

  it("handles frontmatter-only content", () => {
    const result = parseNote("fm.md", "---\ntitle: Test\n---\n");
    expect(result.frontmatter.title).toBe("Test");
    expect(result.links).toEqual([]);
  });
});
