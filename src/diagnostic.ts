import type { Span } from "./lexer/token.js";
import type { TopForm } from "./parser/ast.js";

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

export function topFormPath(form: TopForm, index: number): string {
  switch (form.k) {
    case "defn":
      return `(defn ${form.name})`;
    case "typeDef":
      return `(type ${form.name})`;
    case "effectDef":
      return `(effect ${form.name})`;
    case "prop":
      return `(prop ${index})`;
    case "example":
      return `(example ${index})`;
    default:
      return `(${form.k})`;
  }
}

export function astPath(base: string, ...segments: (string | number)[]): string {
  return segments.length === 0 ? base : `${base}.${segments.join(".")}`;
}
