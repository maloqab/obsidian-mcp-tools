import { tokenize } from "./lexer.js";
import {
  Token,
  TokenType,
  Query,
  TableQuery,
  ListQuery,
  TaskQuery,
  CalendarQuery,
  Expr,
  FieldExpr,
  SortExpr,
  SourceExpr,
} from "./types.js";

class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // --- Helper methods ---

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: TokenType.EOF, value: "" };
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== TokenType.EOF) {
      this.pos++;
    }
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new Error(
        `Expected token ${type} but got ${token.type} ("${token.value}") at position ${this.pos}`,
      );
    }
    return this.advance();
  }

  private match(...types: TokenType[]): Token | null {
    if (types.includes(this.peek().type)) {
      return this.advance();
    }
    return null;
  }

  private isClauseKeyword(): boolean {
    const t = this.peek().type;
    return (
      t === TokenType.FROM ||
      t === TokenType.WHERE ||
      t === TokenType.SORT ||
      t === TokenType.GROUP ||
      t === TokenType.FLATTEN ||
      t === TokenType.LIMIT ||
      t === TokenType.EOF
    );
  }

  // --- Top-level ---

  parseQuery(): Query {
    const token = this.peek();
    switch (token.type) {
      case TokenType.TABLE:
        return this.parseTableQuery();
      case TokenType.LIST:
        return this.parseListQuery();
      case TokenType.TASK:
        return this.parseTaskQuery();
      case TokenType.CALENDAR:
        return this.parseCalendarQuery();
      default:
        throw new Error(
          `Expected query type (TABLE, LIST, TASK, CALENDAR) but got ${token.type} ("${token.value}")`,
        );
    }
  }

  // --- TABLE ---

  private parseTableQuery(): TableQuery {
    this.expect(TokenType.TABLE);

    let withoutId = false;
    if (this.match(TokenType.WITHOUT_ID)) {
      withoutId = true;
    }

    // Parse field list (until a clause keyword or EOF)
    const fields: FieldExpr[] = [];
    if (!this.isClauseKeyword()) {
      fields.push(this.parseFieldExpr());
      while (this.match(TokenType.COMMA)) {
        fields.push(this.parseFieldExpr());
      }
    }

    const clauses = this.parseClauses();

    return {
      type: "TABLE",
      fields,
      withoutId,
      ...clauses,
    };
  }

  // --- LIST ---

  private parseListQuery(): ListQuery {
    this.expect(TokenType.LIST);

    let withoutId = false;
    if (this.match(TokenType.WITHOUT_ID)) {
      withoutId = true;
    }

    // Optional expression before clauses
    let expression: Expr | undefined;
    if (!this.isClauseKeyword()) {
      expression = this.parseExpr();
    }

    const clauses = this.parseClauses();

    return {
      type: "LIST",
      expression,
      withoutId,
      ...clauses,
    };
  }

  // --- TASK ---

  private parseTaskQuery(): TaskQuery {
    this.expect(TokenType.TASK);
    const clauses = this.parseClauses();

    return {
      type: "TASK",
      ...clauses,
    };
  }

  // --- CALENDAR ---

  private parseCalendarQuery(): CalendarQuery {
    this.expect(TokenType.CALENDAR);

    const dateField = this.parseExpr();
    const clauses = this.parseClauses();

    return {
      type: "CALENDAR",
      dateField,
      from: clauses.from,
      where: clauses.where,
    };
  }

  // --- Clauses ---

  private parseClauses(): {
    from?: SourceExpr;
    where?: Expr;
    sort?: SortExpr[];
    groupBy?: Expr;
    flatten?: Expr[];
    limit?: number;
  } {
    let from: SourceExpr | undefined;
    let where: Expr | undefined;
    let sort: SortExpr[] | undefined;
    let groupBy: Expr | undefined;
    const flatten: Expr[] = [];
    let limit: number | undefined;

    // Parse clauses in any order
    while (this.peek().type !== TokenType.EOF) {
      if (this.match(TokenType.FROM)) {
        from = this.parseFrom();
      } else if (this.match(TokenType.WHERE)) {
        where = this.parseExpr();
      } else if (this.match(TokenType.SORT)) {
        sort = this.parseSortList();
      } else if (this.peek().type === TokenType.GROUP) {
        this.advance(); // consume GROUP
        this.expect(TokenType.BY);
        groupBy = this.parseExpr();
      } else if (this.match(TokenType.FLATTEN)) {
        flatten.push(this.parseExpr());
      } else if (this.match(TokenType.LIMIT)) {
        const numToken = this.expect(TokenType.NUMBER);
        limit = parseInt(numToken.value, 10);
      } else {
        // Unknown token in clause position -- stop parsing clauses
        break;
      }
    }

    const result: ReturnType<typeof this.parseClauses> = {};
    if (from !== undefined) result.from = from;
    if (where !== undefined) result.where = where;
    if (sort !== undefined) result.sort = sort;
    if (groupBy !== undefined) result.groupBy = groupBy;
    if (flatten.length > 0) result.flatten = flatten;
    if (limit !== undefined) result.limit = limit;

    return result;
  }

  // --- Field expressions (for TABLE) ---

  private parseFieldExpr(): FieldExpr {
    const expr = this.parseExpr();
    let alias: string | undefined;

    if (this.match(TokenType.AS)) {
      const aliasToken = this.advance();
      if (aliasToken.type === TokenType.STRING) {
        alias = aliasToken.value;
      } else if (aliasToken.type === TokenType.IDENTIFIER) {
        alias = aliasToken.value;
      } else {
        throw new Error(
          `Expected alias name after AS but got ${aliasToken.type}`,
        );
      }
    }

    return { expr, alias };
  }

  // --- FROM (source expressions) ---

  private parseFrom(): SourceExpr {
    return this.parseSourceOr();
  }

  private parseSourceOr(): SourceExpr {
    let left = this.parseSourceAnd();

    while (this.peek().type === TokenType.OR) {
      this.advance();
      const right = this.parseSourceAnd();
      left = { kind: "binary", op: "OR", left, right };
    }

    return left;
  }

  private parseSourceAnd(): SourceExpr {
    let left = this.parseSourceUnary();

    while (this.peek().type === TokenType.AND) {
      this.advance();
      const right = this.parseSourceUnary();
      left = { kind: "binary", op: "AND", left, right };
    }

    return left;
  }

  private parseSourceUnary(): SourceExpr {
    // Negation: -#tag or -"folder"
    if (this.peek().type === TokenType.MINUS) {
      this.advance();
      const source = this.parseSourcePrimary();
      return { kind: "negated", source };
    }

    return this.parseSourcePrimary();
  }

  private parseSourcePrimary(): SourceExpr {
    const token = this.peek();

    if (token.type === TokenType.TAG) {
      this.advance();
      return { kind: "tag", tag: token.value };
    }

    if (token.type === TokenType.STRING) {
      this.advance();
      return { kind: "folder", path: token.value };
    }

    if (token.type === TokenType.WIKILINK) {
      this.advance();
      return { kind: "link", note: token.value, direction: "both" };
    }

    if (token.type === TokenType.LPAREN) {
      this.advance();
      const source = this.parseFrom();
      this.expect(TokenType.RPAREN);
      return source;
    }

    throw new Error(
      `Expected source (tag, folder, wikilink) but got ${token.type} ("${token.value}")`,
    );
  }

  // --- SORT ---

  private parseSortList(): SortExpr[] {
    const sorts: SortExpr[] = [];
    sorts.push(this.parseSortExpr());

    while (this.match(TokenType.COMMA)) {
      sorts.push(this.parseSortExpr());
    }

    return sorts;
  }

  private parseSortExpr(): SortExpr {
    const expr = this.parseExpr();
    let direction: "asc" | "desc" = "asc";

    if (this.match(TokenType.ASC)) {
      direction = "asc";
    } else if (this.match(TokenType.DESC)) {
      direction = "desc";
    }

    return { expr, direction };
  }

  // --- Expression parsing with precedence ---

  parseExpr(): Expr {
    return this.parseOrExpr();
  }

  private parseOrExpr(): Expr {
    let left = this.parseAndExpr();

    while (this.peek().type === TokenType.OR) {
      this.advance();
      const right = this.parseAndExpr();
      left = { kind: "binary", op: "OR", left, right };
    }

    return left;
  }

  private parseAndExpr(): Expr {
    let left = this.parseComparison();

    while (this.peek().type === TokenType.AND) {
      this.advance();
      const right = this.parseComparison();
      left = { kind: "binary", op: "AND", left, right };
    }

    return left;
  }

  private parseComparison(): Expr {
    let left = this.parseAddSub();

    const compOps = [
      TokenType.EQ,
      TokenType.NEQ,
      TokenType.LT,
      TokenType.GT,
      TokenType.LTE,
      TokenType.GTE,
    ];

    while (compOps.includes(this.peek().type)) {
      const op = this.advance();
      const right = this.parseAddSub();
      left = { kind: "binary", op: op.value, left, right };
    }

    return left;
  }

  private parseAddSub(): Expr {
    let left = this.parseMulDiv();

    while (
      this.peek().type === TokenType.PLUS ||
      this.peek().type === TokenType.MINUS
    ) {
      const op = this.advance();
      const right = this.parseMulDiv();
      left = { kind: "binary", op: op.value, left, right };
    }

    return left;
  }

  private parseMulDiv(): Expr {
    let left = this.parseUnary();

    while (
      this.peek().type === TokenType.STAR ||
      this.peek().type === TokenType.SLASH
    ) {
      const op = this.advance();
      const right = this.parseUnary();
      left = { kind: "binary", op: op.value, left, right };
    }

    return left;
  }

  private parseUnary(): Expr {
    if (this.peek().type === TokenType.NOT) {
      const op = this.advance();
      const operand = this.parseUnary();
      return { kind: "unary", op: op.value, operand };
    }

    if (this.peek().type === TokenType.MINUS) {
      const op = this.advance();
      const operand = this.parseUnary();
      return { kind: "unary", op: op.value, operand };
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.peek();

    // Number literal
    if (token.type === TokenType.NUMBER) {
      this.advance();
      const num = parseFloat(token.value);
      return this.parsePostfix({ kind: "literal", value: num });
    }

    // String literal
    if (token.type === TokenType.STRING) {
      this.advance();
      return this.parsePostfix({ kind: "literal", value: token.value });
    }

    // Boolean literal
    if (token.type === TokenType.BOOLEAN) {
      this.advance();
      return {
        kind: "literal",
        value: token.value.toUpperCase() === "TRUE",
      };
    }

    // Null literal
    if (token.type === TokenType.NULL) {
      this.advance();
      return { kind: "literal", value: null };
    }

    // Parenthesized expression
    if (token.type === TokenType.LPAREN) {
      this.advance();
      const expr = this.parseExpr();
      this.expect(TokenType.RPAREN);
      return this.parsePostfix(expr);
    }

    // List literal [...]
    if (token.type === TokenType.LBRACKET) {
      this.advance();
      const items: Expr[] = [];
      if (this.peek().type !== TokenType.RBRACKET) {
        items.push(this.parseExpr());
        while (this.match(TokenType.COMMA)) {
          items.push(this.parseExpr());
        }
      }
      this.expect(TokenType.RBRACKET);
      return this.parsePostfix({ kind: "list", items });
    }

    // Identifier (possibly with field access or function call)
    if (token.type === TokenType.IDENTIFIER) {
      this.advance();
      let expr: Expr = { kind: "identifier", name: token.value };

      // Function call: identifier followed by (
      if (this.peek().type === TokenType.LPAREN) {
        this.advance(); // consume (
        const args: Expr[] = [];
        if (this.peek().type !== TokenType.RPAREN) {
          args.push(this.parseExpr());
          while (this.match(TokenType.COMMA)) {
            args.push(this.parseExpr());
          }
        }
        this.expect(TokenType.RPAREN);
        expr = { kind: "functionCall", name: token.value, args };
      }

      return this.parsePostfix(expr);
    }

    throw new Error(
      `Unexpected token ${token.type} ("${token.value}") at position ${this.pos}`,
    );
  }

  /**
   * Handle postfix operations: field access via dot notation.
   * e.g., file.name, file.tags
   */
  private parsePostfix(expr: Expr): Expr {
    while (this.peek().type === TokenType.DOT) {
      this.advance(); // consume DOT
      const fieldToken = this.expect(TokenType.IDENTIFIER);
      expr = { kind: "fieldAccess", object: expr, field: fieldToken.value };
    }
    return expr;
  }
}

/**
 * Parse a DQL query string into an AST.
 */
export function parse(input: string): Query {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  return parser.parseQuery();
}
