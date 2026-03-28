import { describe, it, expect } from "vitest";
import { parse } from "../../../src/tools/dataview/parser.js";

describe("DQL Parser", () => {
  it("parses a simple TABLE query", () => {
    const ast = parse("TABLE file.name, rating FROM #books");
    expect(ast.type).toBe("TABLE");
    if (ast.type === "TABLE") {
      expect(ast.fields).toHaveLength(2);
      expect(ast.from?.kind).toBe("tag");
    }
  });

  it("parses TABLE WITHOUT ID", () => {
    const ast = parse("TABLE WITHOUT ID file.name FROM #books");
    if (ast.type === "TABLE") {
      expect(ast.withoutId).toBe(true);
    }
  });

  it("parses LIST query", () => {
    const ast = parse('LIST FROM "Projects"');
    expect(ast.type).toBe("LIST");
    if (ast.type === "LIST") {
      expect(ast.from?.kind).toBe("folder");
    }
  });

  it("parses WHERE with comparison", () => {
    const ast = parse("TABLE file.name FROM #books WHERE rating >= 4");
    if (ast.type === "TABLE") {
      expect(ast.where?.kind).toBe("binary");
    }
  });

  it("parses WHERE with AND/OR", () => {
    const ast = parse('TABLE file.name WHERE status = "active" AND priority > 2');
    if (ast.type === "TABLE") {
      expect(ast.where?.kind).toBe("binary");
      if (ast.where?.kind === "binary") {
        expect(ast.where.op).toBe("AND");
      }
    }
  });

  it("parses SORT", () => {
    const ast = parse("TABLE file.name SORT rating DESC");
    if (ast.type === "TABLE") {
      expect(ast.sort).toHaveLength(1);
      expect(ast.sort![0].direction).toBe("desc");
    }
  });

  it("parses GROUP BY", () => {
    const ast = parse("TABLE file.name GROUP BY genre");
    if (ast.type === "TABLE") {
      expect(ast.groupBy?.kind).toBe("identifier");
    }
  });

  it("parses FLATTEN", () => {
    const ast = parse("TABLE file.name FLATTEN authors");
    if (ast.type === "TABLE") {
      expect(ast.flatten).toHaveLength(1);
    }
  });

  it("parses LIMIT", () => {
    const ast = parse("TABLE file.name LIMIT 10");
    if (ast.type === "TABLE") {
      expect(ast.limit).toBe(10);
    }
  });

  it("parses TASK query", () => {
    const ast = parse("TASK FROM #todo WHERE !completed");
    expect(ast.type).toBe("TASK");
  });

  it("parses function calls in WHERE", () => {
    const ast = parse('TABLE file.name WHERE contains(file.name, "test")');
    if (ast.type === "TABLE" && ast.where?.kind === "functionCall") {
      expect(ast.where.name).toBe("contains");
      expect(ast.where.args).toHaveLength(2);
    }
  });

  it("parses compound FROM with AND", () => {
    const ast = parse('TABLE file.name FROM #books AND "Reading"');
    if (ast.type === "TABLE") {
      expect(ast.from?.kind).toBe("binary");
    }
  });

  it("parses FROM with negation", () => {
    const ast = parse("TABLE file.name FROM #books AND -#fiction");
    if (ast.type === "TABLE" && ast.from?.kind === "binary") {
      expect(ast.from.right.kind).toBe("negated");
    }
  });

  it("parses FROM wikilink", () => {
    const ast = parse("TABLE file.name FROM [[My Note]]");
    if (ast.type === "TABLE") {
      expect(ast.from?.kind).toBe("link");
    }
  });

  it("parses field aliases", () => {
    const ast = parse('TABLE file.name AS "Name", rating AS "Score" FROM #books');
    if (ast.type === "TABLE") {
      expect(ast.fields[0].alias).toBe("Name");
      expect(ast.fields[1].alias).toBe("Score");
    }
  });
});
