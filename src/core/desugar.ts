import { astPath, topFormPath } from "../diagnostic.js";
import type { Diagnostic } from "../diagnostic.js";
import type { Span } from "../lexer/token.js";
import type * as ast from "../parser/ast.js";
import type { Type } from "../types/type.js";
import type { Core, MatchArm, Param, Pattern, Value } from "./ir.js";

export type CoreTopForm =
  | { k: "defn"; name: string; params: Param[]; ret: Type; body: Core; pure: boolean; span: Span; path: string }
  | { k: "type"; name: string; type: Type; span: Span; path: string }
  | { k: "effect"; name: string; type: Type; span: Span; path: string }
  | { k: "prop"; name: string; params: Param[]; body: Core; span: Span; path: string }
  | { k: "example"; actual: Core; expected: Core; span: Span; path: string }
  | { k: "import"; path: string; names: string[]; span: Span }
  | { k: "export"; names: string[]; span: Span }
  | { k: "error"; message: string; span: Span; path: string };

export interface DesugarResult {
  defs: CoreTopForm[];
  diagnostics: Diagnostic[];
}

export function desugar(program: ast.Program): DesugarResult {
  return new Desugarer().run(program);
}

export function desugarExpr(e: ast.Expr, path = "(expr)"): Core {
  return new Desugarer().expr(e, path);
}

class Desugarer {
  readonly diagnostics: Diagnostic[] = [];
  private fresh = 0;

  run(program: ast.Program): DesugarResult {
    const defs: CoreTopForm[] = [];
    let propIndex = 0;
    let exampleIndex = 0;
    for (const form of program.forms) {
      const index = form.k === "prop" ? propIndex++ : form.k === "example" ? exampleIndex++ : 0;
      const path = topFormPath(form, index);
      defs.push(this.topForm(form, path));
    }
    return { defs, diagnostics: this.diagnostics };
  }

  private nextFresh(base: string): string {
    const name = this.fresh === 0 ? base : `${base}${this.fresh}`;
    this.fresh++;
    return name;
  }

  private error(span: Span, message: string, path: string): void {
    this.diagnostics.push({ kind: "parse-error", severity: "error", span, message, data: { path } });
  }

  private topForm(form: ast.TopForm, path: string): CoreTopForm {
    switch (form.k) {
      case "import":
        return { k: "import", path: form.path, names: form.names, span: form.span };
      case "export":
        return { k: "export", names: form.names, span: form.span };
      case "typeDef":
        return { k: "type", name: form.name, type: this.type(form.type, astPath(path, "type")), span: form.span, path };
      case "effectDef":
        return { k: "effect", name: form.name, type: this.type(form.type, astPath(path, "type")), span: form.span, path };
      case "defn":
        return {
          k: "defn",
          name: form.name,
          params: form.params.map((p, i) => this.param(p, astPath(path, "params", i))),
          ret: this.type(form.ret, astPath(path, "ret")),
          body: this.expr(form.body, astPath(path, "body")),
          pure: !form.effect,
          span: form.span,
          path,
        };
      case "prop":
        return {
          k: "prop",
          name: form.name,
          params: form.params.map((p, i) => this.param(p, astPath(path, "params", i))),
          body: this.expr(form.body, astPath(path, "body")),
          span: form.span,
          path,
        };
      case "example":
        return {
          k: "example",
          actual: this.expr(form.actual, astPath(path, "args", 0)),
          expected: this.expr(form.expected, astPath(path, "args", 2)),
          span: form.span,
          path,
        };
      case "error":
        this.error(form.span, form.message, path);
        return { k: "error", message: form.message, span: form.span, path };
    }
  }

  private param(p: ast.Param, path: string): Param {
    return { name: p.name, type: this.type(p.type, astPath(path, "type")) };
  }

  private type(t: ast.TypeExpr, path: string): Type {
    switch (t.k) {
      case "prim":
        return { k: t.name };
      case "alias":
        return { k: "alias", name: t.name };
      case "array":
        return { k: "array", element: this.type(t.element, astPath(path, "element")) };
      case "union":
        return { k: "union", members: t.members.map((m, i) => this.type(m, astPath(path, "members", i))) };
      case "obj": {
        const fields = new Map<string, Type>();
        t.fields.forEach((f, i) => {
          if (f.k === "field") {
            fields.set(f.name, this.type(f.type, astPath(path, "fields", i, "type")));
          } else {
            fields.set(f.name, { k: "literal", value: f.value });
          }
        });
        return { k: "obj", fields };
      }
      case "result":
        return { k: "result", ok: this.type(t.ok, astPath(path, "ok")), err: this.type(t.err, astPath(path, "err")) };
      case "fn":
        return {
          k: "fn",
          params: t.params.map((p, i) => this.type(p.type, astPath(path, "params", i, "type"))),
          ret: this.type(t.ret, astPath(path, "ret")),
        };
      case "error":
        this.error(t.span, t.message, path);
        return { k: "alias", name: "<parse-error>" };
    }
  }

  expr(e: ast.Expr, path: string): Core {
    switch (e.k) {
      case "lit":
        return { k: "Lit", value: e.value as Value, span: e.span };
      case "sym":
        if (e.effect) {
          return { k: "EffectCall", effect: e.name.replace(/!$/, ""), args: [], span: e.span };
        }
        return { k: "Var", name: e.name, span: e.span };
      case "fieldAccess": {
        let acc: Core = { k: "Var", name: e.parts[0], span: e.span };
        for (let i = 1; i < e.parts.length; i++) {
          acc = { k: "Field", obj: acc, name: e.parts[i], span: e.span };
        }
        return acc;
      }
      case "app":
        if (e.effect) {
          return {
            k: "EffectCall",
            effect: e.fn.replace(/!$/, ""),
            args: e.args.map((a, i) => this.expr(a, astPath(path, "args", i))),
            span: e.span,
          };
        }
        return {
          k: "App",
          fn: { k: "Var", name: e.fn, span: e.span },
          args: e.args.map((a, i) => this.expr(a, astPath(path, "args", i))),
          span: e.span,
        };
      case "let": {
        let body = this.expr(e.body, astPath(path, "body"));
        for (let i = e.binds.length - 1; i >= 0; i--) {
          const b = e.binds[i];
          body = {
            k: "Let",
            name: b.name,
            rhs: this.expr(b.expr, astPath(path, "binds", i)),
            body,
            span: e.span,
          };
        }
        return body;
      }
      case "if":
        return {
          k: "If",
          cond: this.expr(e.cond, astPath(path, "cond")),
          then: this.expr(e.then, astPath(path, "then")),
          else: this.expr(e.else, astPath(path, "else")),
          span: e.span,
        };
      case "when":
        return {
          k: "If",
          cond: this.expr(e.cond, astPath(path, "cond")),
          then: this.expr(e.body, astPath(path, "body")),
          else: { k: "Lit", value: null, span: e.span },
          span: e.span,
        };
      case "cond": {
        let acc = this.expr(e.else, astPath(path, "arms", e.arms.length));
        for (let i = e.arms.length - 1; i >= 0; i--) {
          const arm = e.arms[i];
          acc = {
            k: "If",
            cond: this.expr(arm.cond, astPath(path, "arms", i)),
            then: this.expr(arm.body, astPath(path, "arms", i)),
            else: acc,
            span: e.span,
          };
        }
        return acc;
      }
      case "and":
        return {
          k: "If",
          cond: this.expr(e.left, astPath(path, "args", 0)),
          then: this.expr(e.right, astPath(path, "args", 1)),
          else: { k: "Lit", value: false, span: e.span },
          span: e.span,
        };
      case "or": {
        const t = this.nextFresh("$t");
        return {
          k: "Let",
          name: t,
          rhs: this.expr(e.left, astPath(path, "args", 0)),
          body: {
            k: "If",
            cond: { k: "Var", name: t, span: e.span },
            then: { k: "Lit", value: true, span: e.span },
            else: this.expr(e.right, astPath(path, "args", 1)),
            span: e.span,
          },
          span: e.span,
        };
      }
      case "match":
        return {
          k: "Match",
          scrutinee: this.expr(e.scrutinee, astPath(path, "scrutinee")),
          arms: e.arms.map((a, i): MatchArm => ({
            pattern: this.pattern(a.pattern),
            body: this.expr(a.body, astPath(path, "arms", i)),
          })),
          span: e.span,
        };
      case "do":
        return {
          k: "Do",
          binds: e.binds.map((b, i) => ({ name: b.name, expr: this.expr(b.expr, astPath(path, "binds", i)) })),
          body: this.expr(e.body, astPath(path, "body")),
          span: e.span,
        };
      case "obj":
        return {
          k: "Obj",
          fields: e.fields.map((f, i) => [f.name, this.expr(f.expr, astPath(path, "fields", i))] as [string, Core]),
          span: e.span,
        };
      case "fn":
        return {
          k: "Lam",
          params: e.params.map((p, i) => this.param(p, astPath(path, "params", i))),
          ret: this.type(e.ret, astPath(path, "ret")),
          body: this.expr(e.body, astPath(path, "body")),
          pure: true,
          span: e.span,
        };
      case "pipe": {
        let acc = this.expr(e.exprs[0], astPath(path, "args", 0));
        for (let i = 1; i < e.exprs.length; i++) {
          acc = {
            k: "App",
            fn: this.expr(e.exprs[i], astPath(path, "args", i)),
            args: [acc],
            span: e.span,
          };
        }
        return acc;
      }
      case "error":
        this.error(e.span, e.message, path);
        return { k: "Error", message: e.message, span: e.span };
    }
  }

  private pattern(p: ast.Pattern): Pattern {
    switch (p.k) {
      case "wildcard":
        return { k: "wildcard" };
      case "pvar":
        return { k: "var", name: p.name };
      case "plit":
        return { k: "lit", value: p.value as Value };
      case "pobj":
        return { k: "obj", fields: p.fields.map((f) => [f.name, this.pattern(f.pattern)] as [string, Pattern]) };
      case "parray":
        return { k: "array", elements: p.elements.map((el) => this.pattern(el)) };
      case "por":
        return { k: "or", patterns: p.patterns.map((el) => this.pattern(el)) };
    }
  }
}
