import type { Span } from "../lexer/token.js";

export interface Trivia {
  leading: string[];
}

interface Base extends Trivia {
  span: Span;
}

export interface Program extends Base {
  k: "program";
  forms: TopForm[];
  trailing: string[];
}

export type TopForm = Import | Export | TypeDef | EffectDef | Defn | Prop | Example | ErrorNode;

export interface Import extends Base {
  k: "import";
  path: string;
  names: string[];
}

export interface Export extends Base {
  k: "export";
  names: string[];
}

export interface TypeDef extends Base {
  k: "typeDef";
  name: string;
  type: TypeExpr;
}

export interface EffectDef extends Base {
  k: "effectDef";
  name: string;
  type: TypeExpr;
}

export interface Defn extends Base {
  k: "defn";
  effect: boolean;
  name: string;
  params: Param[];
  ret: TypeExpr;
  body: Expr;
}

export interface Prop extends Base {
  k: "prop";
  name: string;
  params: Param[];
  body: Expr;
}

export interface Example extends Base {
  k: "example";
  actual: Expr;
  expected: Expr;
}

export interface Param extends Base {
  k: "param";
  name: string;
  type: TypeExpr;
}

export type Field =
  | { k: "field"; name: string; type: TypeExpr; span: Span; leading: string[] }
  | { k: "tag"; name: string; value: string; span: Span; leading: string[] };

export type TypeExpr =
  | { k: "prim"; name: "number" | "string" | "bool" | "nil"; span: Span; leading: string[] }
  | { k: "alias"; name: string; span: Span; leading: string[] }
  | { k: "array"; element: TypeExpr; span: Span; leading: string[] }
  | { k: "union"; members: TypeExpr[]; span: Span; leading: string[] }
  | { k: "obj"; fields: Field[]; span: Span; leading: string[] }
  | { k: "result"; ok: TypeExpr; err: TypeExpr; span: Span; leading: string[] }
  | { k: "fn"; params: Param[]; ret: TypeExpr; span: Span; leading: string[] }
  | { k: "error"; message: string; span: Span; leading: string[] };

export type Expr =
  | Lit
  | Sym
  | FieldAccess
  | App
  | Let
  | If
  | When
  | Cond
  | And
  | Or
  | Match
  | Do
  | Obj
  | Fn
  | Pipe
  | ErrorNode;

export interface Lit extends Base {
  k: "lit";
  litKind: "number" | "string" | "bool" | "nil";
  value: number | string | boolean | null;
}

export interface Sym extends Base {
  k: "sym";
  name: string;
  effect: boolean;
}

export interface FieldAccess extends Base {
  k: "fieldAccess";
  parts: string[];
}

export interface App extends Base {
  k: "app";
  fn: string;
  effect: boolean;
  args: Expr[];
}

export interface Bind extends Base {
  k: "bind";
  name: string;
  expr: Expr;
}

export interface Let extends Base {
  k: "let";
  binds: Bind[];
  body: Expr;
}

export interface If extends Base {
  k: "if";
  cond: Expr;
  then: Expr;
  else: Expr;
}

export interface When extends Base {
  k: "when";
  cond: Expr;
  body: Expr;
}

export interface CondArm extends Base {
  k: "condArm";
  cond: Expr;
  body: Expr;
}

export interface Cond extends Base {
  k: "cond";
  arms: CondArm[];
  else: Expr;
}

export interface And extends Base {
  k: "and";
  left: Expr;
  right: Expr;
}

export interface Or extends Base {
  k: "or";
  left: Expr;
  right: Expr;
}

export interface MatchArm extends Base {
  k: "matchArm";
  pattern: Pattern;
  body: Expr;
}

export interface Match extends Base {
  k: "match";
  scrutinee: Expr;
  arms: MatchArm[];
}

export interface DoBind extends Base {
  k: "doBind";
  name: string;
  expr: Expr;
}

export interface Do extends Base {
  k: "do";
  binds: DoBind[];
  body: Expr;
}

export interface ObjField extends Base {
  k: "objField";
  name: string;
  expr: Expr;
}

export interface Obj extends Base {
  k: "obj";
  fields: ObjField[];
}

export interface Fn extends Base {
  k: "fn";
  params: Param[];
  ret: TypeExpr;
  body: Expr;
}

export interface Pipe extends Base {
  k: "pipe";
  exprs: Expr[];
}

export interface ErrorNode extends Base {
  k: "error";
  message: string;
}

export type Pattern =
  | { k: "wildcard"; span: Span; leading: string[] }
  | { k: "pvar"; name: string; span: Span; leading: string[] }
  | { k: "plit"; litKind: "number" | "string" | "bool" | "nil"; value: number | string | boolean | null; span: Span; leading: string[] }
  | { k: "pobj"; fields: { name: string; pattern: Pattern; span: Span; leading: string[] }[]; span: Span; leading: string[] }
  | { k: "parray"; elements: Pattern[]; span: Span; leading: string[] }
  | { k: "por"; patterns: Pattern[]; span: Span; leading: string[] };
