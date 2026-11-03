import type { CoreTopForm } from "../core/desugar.js";
import type { Core } from "../core/ir.js";
import type { Diagnostic } from "../diagnostic.js";
import type { Span } from "../lexer/token.js";

export interface EffectCallSite {
  effect: string;
  span: Span;
}

export function findEffectCalls(e: Core, out: EffectCallSite[] = []): EffectCallSite[] {
  switch (e.k) {
    case "EffectCall":
      out.push({ effect: e.effect, span: e.span });
      for (const a of e.args) findEffectCalls(a, out);
      return out;
    case "Lam":
      findEffectCalls(e.body, out);
      return out;
    case "App":
      findEffectCalls(e.fn, out);
      for (const a of e.args) findEffectCalls(a, out);
      return out;
    case "Let":
      findEffectCalls(e.rhs, out);
      findEffectCalls(e.body, out);
      return out;
    case "If":
      findEffectCalls(e.cond, out);
      findEffectCalls(e.then, out);
      findEffectCalls(e.else, out);
      return out;
    case "Match":
      findEffectCalls(e.scrutinee, out);
      for (const a of e.arms) findEffectCalls(a.body, out);
      return out;
    case "Obj":
      for (const [, c] of e.fields) findEffectCalls(c, out);
      return out;
    case "Field":
      findEffectCalls(e.obj, out);
      return out;
    case "Do":
      for (const b of e.binds) findEffectCalls(b.expr, out);
      findEffectCalls(e.body, out);
      return out;
    default:
      return out;
  }
}

export function checkEffects(defs: CoreTopForm[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const d of defs) {
    if (d.k !== "defn" || !d.pure) continue;
    for (const site of findEffectCalls(d.body)) {
      diags.push({
        kind: "effect-violation",
        severity: "error",
        span: site.span,
        message: `純粋関数 '${d.name}' の本体でエフェクト '${site.effect}!' を呼んでいます（defn! が必要です §7.4）`,
        data: { path: d.path, effect: site.effect },
        fix: { op: "replace", path: d.path, template: "defn!" },
      });
    }
  }
  return diags;
}
