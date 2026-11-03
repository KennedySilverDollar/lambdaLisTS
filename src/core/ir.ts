import type { Span } from "../lexer/token.js";
import type { Type } from "../types/type.js";

export type Value =
  | number
  | string
  | boolean
  | null
  | Value[]
  | { [key: string]: Value }
  | { tag: "Ok"; value: Value }
  | { tag: "Err"; value: Value }
  | Closure;

export interface Closure {
  params: Param[];
  ret: Type;
  body: Core;
  env: Map<string, Value>;
  name: string | null;
}

export type Core =
  | { k: "Lit"; value: Value; span: Span }
  | { k: "Var"; name: string; span: Span }
  | { k: "Lam"; params: Param[]; ret: Type; body: Core; pure: boolean; span: Span }
  | { k: "App"; fn: Core; args: Core[]; span: Span }
  | { k: "Let"; name: string; rhs: Core; body: Core; span: Span }
  | { k: "If"; cond: Core; then: Core; else: Core; span: Span }
  | { k: "Match"; scrutinee: Core; arms: MatchArm[]; span: Span }
  | { k: "Obj"; fields: [string, Core][]; span: Span }
  | { k: "Field"; obj: Core; name: string; span: Span }
  | { k: "EffectCall"; effect: string; args: Core[]; span: Span }
  | { k: "Do"; binds: { name: string; expr: Core }[]; body: Core; span: Span }
  | { k: "Error"; message: string; span: Span };

export type Param = { name: string; type: Type };

export type MatchArm = { pattern: Pattern; body: Core };

export type Pattern =
  | { k: "wildcard" }
  | { k: "var"; name: string }
  | { k: "lit"; value: Value }
  | { k: "obj"; fields: [string, Pattern][] }
  | { k: "array"; elements: Pattern[] }
  | { k: "or"; patterns: Pattern[] };
