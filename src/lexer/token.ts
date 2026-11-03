export interface Span {
  file: string;
  start: number;
  end: number;
  line: number;
  col: number;
}

export type TokenType =
  | "paren"
  | "bracket"
  | "brace"
  | "punct"
  | "number"
  | "string"
  | "keyword"
  | "symbol"
  | "dottedSymbol"
  | "nil"
  | "bool"
  | "error";

export interface Token {
  type: TokenType;
  text: string;
  value?: unknown;
  span: Span;
  leading: string[];
}
