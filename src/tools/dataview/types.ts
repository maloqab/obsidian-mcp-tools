// --- Token Types ---
export enum TokenType {
  // Query types
  TABLE = "TABLE", LIST = "LIST", TASK = "TASK", CALENDAR = "CALENDAR",
  // Clauses
  FROM = "FROM", WHERE = "WHERE", SORT = "SORT", GROUP = "GROUP",
  BY = "BY", FLATTEN = "FLATTEN", LIMIT = "LIMIT",
  // Operators
  AND = "AND", OR = "OR", NOT = "NOT",
  EQ = "EQ", NEQ = "NEQ", LT = "LT", GT = "GT", LTE = "LTE", GTE = "GTE",
  PLUS = "PLUS", MINUS = "MINUS", STAR = "STAR", SLASH = "SLASH",
  // Sort direction
  ASC = "ASC", DESC = "DESC",
  // Literals
  STRING = "STRING", NUMBER = "NUMBER", BOOLEAN = "BOOLEAN", NULL = "NULL",
  DATE = "DATE",
  // Identifiers & refs
  IDENTIFIER = "IDENTIFIER", TAG = "TAG", WIKILINK = "WIKILINK",
  // Punctuation
  COMMA = "COMMA", DOT = "DOT", LPAREN = "LPAREN", RPAREN = "RPAREN",
  LBRACKET = "LBRACKET", RBRACKET = "RBRACKET",
  // Special
  WITHOUT_ID = "WITHOUT_ID", AS = "AS",
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
}

// --- AST Node Types ---
export type QueryType = "TABLE" | "LIST" | "TASK" | "CALENDAR";

export interface TableQuery {
  type: "TABLE";
  fields: FieldExpr[];
  withoutId: boolean;
  from?: SourceExpr;
  where?: Expr;
  sort?: SortExpr[];
  groupBy?: Expr;
  flatten?: Expr[];
  limit?: number;
}

export interface ListQuery {
  type: "LIST";
  expression?: Expr;
  withoutId: boolean;
  from?: SourceExpr;
  where?: Expr;
  sort?: SortExpr[];
  groupBy?: Expr;
  flatten?: Expr[];
  limit?: number;
}

export interface TaskQuery {
  type: "TASK";
  from?: SourceExpr;
  where?: Expr;
  sort?: SortExpr[];
  groupBy?: Expr;
  flatten?: Expr[];
  limit?: number;
}

export interface CalendarQuery {
  type: "CALENDAR";
  dateField: Expr;
  from?: SourceExpr;
  where?: Expr;
}

export type Query = TableQuery | ListQuery | TaskQuery | CalendarQuery;

// --- Expressions ---
export type Expr =
  | LiteralExpr
  | IdentifierExpr
  | BinaryExpr
  | UnaryExpr
  | FunctionCallExpr
  | FieldAccessExpr
  | ListExpr;

export interface LiteralExpr { kind: "literal"; value: string | number | boolean | null; }
export interface IdentifierExpr { kind: "identifier"; name: string; }
export interface BinaryExpr { kind: "binary"; op: string; left: Expr; right: Expr; }
export interface UnaryExpr { kind: "unary"; op: string; operand: Expr; }
export interface FunctionCallExpr { kind: "functionCall"; name: string; args: Expr[]; }
export interface FieldAccessExpr { kind: "fieldAccess"; object: Expr; field: string; }
export interface ListExpr { kind: "list"; items: Expr[]; }

export interface FieldExpr {
  expr: Expr;
  alias?: string;
}

export interface SortExpr {
  expr: Expr;
  direction: "asc" | "desc";
}

// --- Source Expressions ---
export type SourceExpr =
  | TagSource
  | FolderSource
  | LinkSource
  | NegatedSource
  | BinarySource;

export interface TagSource { kind: "tag"; tag: string; }
export interface FolderSource { kind: "folder"; path: string; }
export interface LinkSource { kind: "link"; note: string; direction: "both" | "outgoing" | "incoming"; }
export interface NegatedSource { kind: "negated"; source: SourceExpr; }
export interface BinarySource { kind: "binary"; op: "AND" | "OR"; left: SourceExpr; right: SourceExpr; }

// --- Dataview Result Types ---
export interface DataviewResult {
  type: QueryType;
  headers?: string[];
  rows?: Record<string, unknown>[];
  items?: unknown[];
  tasks?: { text: string; status: string; path: string; line: number }[];
  calendar?: { date: string; path: string }[];
}
