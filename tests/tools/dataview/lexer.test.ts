import { describe, it, expect } from "vitest";
import { tokenize } from "../../../src/tools/dataview/lexer.js";
import { TokenType } from "../../../src/tools/dataview/types.js";

describe("DQL Lexer", () => {
  it("tokenizes a simple TABLE query", () => {
    const tokens = tokenize("TABLE file.name, rating FROM #books");
    expect(tokens[0]).toEqual({ type: TokenType.TABLE, value: "TABLE" });
    expect(tokens.some((t) => t.type === TokenType.IDENTIFIER && t.value === "file")).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.COMMA)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.FROM)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.TAG && t.value === "#books")).toBe(true);
  });

  it("tokenizes WHERE with operators", () => {
    const tokens = tokenize('WHERE rating >= 4 AND status = "active"');
    expect(tokens.some((t) => t.type === TokenType.WHERE)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.GTE)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.AND)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.STRING && t.value === "active")).toBe(true);
  });

  it("tokenizes SORT and GROUP BY", () => {
    const tokens = tokenize("SORT rating DESC GROUP BY genre");
    expect(tokens.some((t) => t.type === TokenType.SORT)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.DESC)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.GROUP)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.BY)).toBe(true);
  });

  it("tokenizes LIST query", () => {
    const tokens = tokenize('LIST FROM "Projects"');
    expect(tokens[0]).toEqual({ type: TokenType.LIST, value: "LIST" });
    expect(tokens.some((t) => t.type === TokenType.STRING && t.value === "Projects")).toBe(true);
  });

  it("tokenizes TASK query", () => {
    const tokens = tokenize("TASK FROM #todo WHERE !completed");
    expect(tokens[0]).toEqual({ type: TokenType.TASK, value: "TASK" });
    expect(tokens.some((t) => t.type === TokenType.NOT)).toBe(true);
  });

  it("tokenizes function calls", () => {
    const tokens = tokenize('WHERE contains(file.name, "test")');
    expect(tokens.some((t) => t.type === TokenType.IDENTIFIER && t.value === "contains")).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.LPAREN)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.RPAREN)).toBe(true);
  });

  it("tokenizes numbers", () => {
    const tokens = tokenize("WHERE rating = 4.5");
    expect(tokens.some((t) => t.type === TokenType.NUMBER && t.value === "4.5")).toBe(true);
  });

  it("tokenizes wikilinks in FROM", () => {
    const tokens = tokenize("FROM [[My Note]]");
    expect(tokens.some((t) => t.type === TokenType.WIKILINK && t.value === "My Note")).toBe(true);
  });

  it("tokenizes FLATTEN and LIMIT", () => {
    const tokens = tokenize("FLATTEN authors LIMIT 10");
    expect(tokens.some((t) => t.type === TokenType.FLATTEN)).toBe(true);
    expect(tokens.some((t) => t.type === TokenType.LIMIT)).toBe(true);
  });
});
