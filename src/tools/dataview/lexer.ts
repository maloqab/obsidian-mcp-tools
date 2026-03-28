import { Token, TokenType } from "./types.js";

// Keyword map: uppercase word -> TokenType
const KEYWORDS: Record<string, TokenType> = {
  TABLE: TokenType.TABLE,
  LIST: TokenType.LIST,
  TASK: TokenType.TASK,
  CALENDAR: TokenType.CALENDAR,
  FROM: TokenType.FROM,
  WHERE: TokenType.WHERE,
  SORT: TokenType.SORT,
  GROUP: TokenType.GROUP,
  BY: TokenType.BY,
  FLATTEN: TokenType.FLATTEN,
  LIMIT: TokenType.LIMIT,
  AND: TokenType.AND,
  OR: TokenType.OR,
  NOT: TokenType.NOT,
  ASC: TokenType.ASC,
  DESC: TokenType.DESC,
  AS: TokenType.AS,
  TRUE: TokenType.BOOLEAN,
  FALSE: TokenType.BOOLEAN,
  NULL: TokenType.NULL,
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;

  function peek(offset = 0): string {
    return input[pos + offset] ?? "";
  }

  function advance(): string {
    return input[pos++] ?? "";
  }

  function skipWhitespace(): void {
    while (pos < input.length && /\s/.test(input[pos])) {
      pos++;
    }
  }

  function readString(quote: string): Token {
    let value = "";
    // skip opening quote
    pos++;
    while (pos < input.length && input[pos] !== quote) {
      if (input[pos] === "\\" && pos + 1 < input.length) {
        pos++; // skip backslash
        const escaped = input[pos];
        switch (escaped) {
          case "n": value += "\n"; break;
          case "t": value += "\t"; break;
          case "r": value += "\r"; break;
          default: value += escaped; break;
        }
      } else {
        value += input[pos];
      }
      pos++;
    }
    pos++; // skip closing quote
    return { type: TokenType.STRING, value };
  }

  function readNumber(startsWithMinus = false): Token {
    let value = startsWithMinus ? "-" : "";
    if (startsWithMinus) pos++; // skip the minus sign

    while (pos < input.length && /[0-9]/.test(input[pos])) {
      value += advance();
    }
    // decimal part
    if (pos < input.length && input[pos] === "." && /[0-9]/.test(input[pos + 1] ?? "")) {
      value += advance(); // consume '.'
      while (pos < input.length && /[0-9]/.test(input[pos])) {
        value += advance();
      }
    }
    return { type: TokenType.NUMBER, value };
  }

  function readIdentifierOrKeyword(): Token {
    let value = "";
    while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
      value += advance();
    }

    const upper = value.toUpperCase();

    // Check for "WITHOUT ID" compound keyword
    if (upper === "WITHOUT") {
      const savedPos = pos;
      // skip whitespace
      let spaces = "";
      while (pos < input.length && /\s/.test(input[pos])) {
        spaces += input[pos];
        pos++;
      }
      // try to read "ID"
      let next = "";
      const nextStart = pos;
      while (pos < input.length && /[a-zA-Z0-9_]/.test(input[pos])) {
        next += advance();
      }
      if (next.toUpperCase() === "ID") {
        return { type: TokenType.WITHOUT_ID, value: "WITHOUT ID" };
      } else {
        // backtrack
        pos = nextStart;
        // restore spaces (already consumed, but they were whitespace, not significant)
        // we can just leave pos after the spaces since we'll skipWhitespace anyway
        // Actually we need to restore fully to before spaces if next word isn't "ID"
        pos = savedPos;
        // fall through to keyword lookup
      }
    }

    if (upper in KEYWORDS) {
      const kwType = KEYWORDS[upper];
      return { type: kwType, value: value };
    }

    return { type: TokenType.IDENTIFIER, value };
  }

  function readTag(): Token {
    // pos is at '#'
    pos++; // skip '#'
    let tagName = "";
    while (pos < input.length && /[a-zA-Z0-9_\-/]/.test(input[pos])) {
      tagName += advance();
    }
    return { type: TokenType.TAG, value: "#" + tagName };
  }

  function readWikilink(): Token {
    // pos is at first '['
    pos += 2; // skip '[['
    let content = "";
    while (pos < input.length) {
      if (input[pos] === "]" && input[pos + 1] === "]") {
        pos += 2; // skip ']]'
        break;
      }
      content += advance();
    }
    return { type: TokenType.WIKILINK, value: content };
  }

  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;

    const ch = input[pos];

    // Wikilink: [[...]]
    if (ch === "[" && peek(1) === "[") {
      tokens.push(readWikilink());
      continue;
    }

    // Tag: #word
    if (ch === "#" && /[a-zA-Z_]/.test(peek(1))) {
      tokens.push(readTag());
      continue;
    }

    // String literals
    if (ch === '"' || ch === "'") {
      tokens.push(readString(ch));
      continue;
    }

    // Numbers (positive)
    if (/[0-9]/.test(ch)) {
      tokens.push(readNumber());
      continue;
    }

    // Negative numbers: only if '-' is followed by digit and previous token is
    // an operator, keyword, or we're at the start
    if (
      ch === "-" &&
      /[0-9]/.test(peek(1)) &&
      (tokens.length === 0 ||
        [
          TokenType.EQ, TokenType.NEQ, TokenType.LT, TokenType.GT,
          TokenType.LTE, TokenType.GTE, TokenType.PLUS, TokenType.MINUS,
          TokenType.STAR, TokenType.SLASH, TokenType.COMMA,
          TokenType.LPAREN, TokenType.LBRACKET,
          TokenType.AND, TokenType.OR, TokenType.NOT,
          TokenType.WHERE, TokenType.SORT, TokenType.FROM,
          TokenType.FLATTEN, TokenType.LIMIT,
        ].includes(tokens[tokens.length - 1].type))
    ) {
      tokens.push(readNumber(true));
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_]/.test(ch)) {
      tokens.push(readIdentifierOrKeyword());
      continue;
    }

    // Multi-char operators
    if (ch === ">" && peek(1) === "=") { pos += 2; tokens.push({ type: TokenType.GTE, value: ">=" }); continue; }
    if (ch === "<" && peek(1) === "=") { pos += 2; tokens.push({ type: TokenType.LTE, value: "<=" }); continue; }
    if (ch === "!" && peek(1) === "=") { pos += 2; tokens.push({ type: TokenType.NEQ, value: "!=" }); continue; }

    // Single-char operators & punctuation
    switch (ch) {
      case "=": pos++; tokens.push({ type: TokenType.EQ, value: "=" }); break;
      case ">": pos++; tokens.push({ type: TokenType.GT, value: ">" }); break;
      case "<": pos++; tokens.push({ type: TokenType.LT, value: "<" }); break;
      case "!": pos++; tokens.push({ type: TokenType.NOT, value: "!" }); break;
      case "+": pos++; tokens.push({ type: TokenType.PLUS, value: "+" }); break;
      case "-": pos++; tokens.push({ type: TokenType.MINUS, value: "-" }); break;
      case "*": pos++; tokens.push({ type: TokenType.STAR, value: "*" }); break;
      case "/": pos++; tokens.push({ type: TokenType.SLASH, value: "/" }); break;
      case ",": pos++; tokens.push({ type: TokenType.COMMA, value: "," }); break;
      case ".": pos++; tokens.push({ type: TokenType.DOT, value: "." }); break;
      case "(": pos++; tokens.push({ type: TokenType.LPAREN, value: "(" }); break;
      case ")": pos++; tokens.push({ type: TokenType.RPAREN, value: ")" }); break;
      case "[": pos++; tokens.push({ type: TokenType.LBRACKET, value: "[" }); break;
      case "]": pos++; tokens.push({ type: TokenType.RBRACKET, value: "]" }); break;
      default:
        // skip unknown characters (e.g. backtick, etc.)
        pos++;
        break;
    }
  }

  tokens.push({ type: TokenType.EOF, value: "" });
  return tokens;
}
