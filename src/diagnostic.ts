import type { Span } from "./lexer/token.js";

export type Patch =
  | { op: "replace"; path: string; template: string }
  | { op: "insert"; path: string; template: string }
  | { op: "delete"; path: string };

export interface Diagnostic {
  kind: string;
  severity: "error" | "warning";
  span: Span;
  message: string;
  data?: object;
  fix?: Patch;
}
