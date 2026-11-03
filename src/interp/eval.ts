import type { CoreTopForm } from "../core/desugar.js";
import type { Core, Pattern, Value } from "../core/ir.js";
import { Env } from "./env.js";
import { stdlibEnv } from "./stdlib.js";
import { EvalError, isBuiltin, isClosure, isPlainObj, isResult, structuralEqual, type Closure } from "./value.js";

export { EvalError } from "./value.js";

export function applyValue(fn: Value, args: Value[]): Value {
  if (isBuiltin(fn)) return fn.fn(args);
  if (isClosure(fn)) {
    if (fn.params.length !== args.length) {
      throw new EvalError(`引数の数が一致しません: '${fn.name ?? "anonymous"}' は ${fn.params.length} 引数`);
    }
    const env = fn.env.child();
    fn.params.forEach((p, i) => env.define(p.name, args[i]));
    return evalCore(fn.body, env);
  }
  throw new EvalError("関数ではない値を呼び出しました");
}

function matchValue(p: Pattern, v: Value, binds: Map<string, Value>): boolean {
  switch (p.k) {
    case "wildcard":
      return true;
    case "var":
      binds.set(p.name, v);
      return true;
    case "lit":
      return p.value === v;
    case "or":
      for (const sub of p.patterns) {
        const subBinds = new Map<string, Value>();
        if (matchValue(sub, v, subBinds)) {
          for (const [k, val] of subBinds) binds.set(k, val);
          return true;
        }
      }
      return false;
    case "obj": {
      if (!isPlainObj(v)) return false;
      const obj = v as Record<string, Value>;
      for (const [name, sub] of p.fields) {
        if (!(name in obj)) return false;
        if (!matchValue(sub, obj[name], binds)) return false;
      }
      return true;
    }
    case "array": {
      if (!Array.isArray(v) || v.length !== p.elements.length) return false;
      return p.elements.every((el, i) => matchValue(el, v[i], binds));
    }
  }
}

export function evalCore(e: Core, env: Env): Value {
  switch (e.k) {
    case "Lit":
      return e.value;
    case "Var": {
      const v = env.lookup(e.name);
      if (v === undefined) throw new EvalError(`未束縛のシンボルです: '${e.name}'`);
      return v;
    }
    case "Lam": {
      const c: Closure = { params: e.params, ret: e.ret, body: e.body, env, name: null };
      return c;
    }
    case "App": {
      const fn = evalCore(e.fn, env);
      const args: Value[] = [];
      for (const a of e.args) args.push(evalCore(a, env));
      return applyValue(fn, args);
    }
    case "Let": {
      const v = evalCore(e.rhs, env);
      const child = env.child();
      child.define(e.name, v);
      return evalCore(e.body, child);
    }
    case "If": {
      const c = evalCore(e.cond, env);
      if (c !== true && c !== false) throw new EvalError("if の条件式は bool でなければなりません");
      return evalCore(c === true ? e.then : e.else, env);
    }
    case "Match": {
      const scrut = evalCore(e.scrutinee, env);
      for (const arm of e.arms) {
        const binds = new Map<string, Value>();
        if (matchValue(arm.pattern, scrut, binds)) {
          const child = env.child();
          for (const [k, v] of binds) child.define(k, v);
          return evalCore(arm.body, child);
        }
      }
      throw new EvalError("match がどのアームにも合致しませんでした");
    }
    case "Obj": {
      const obj: Record<string, Value> = {};
      for (const [name, expr] of e.fields) obj[name] = evalCore(expr, env);
      return obj;
    }
    case "Field": {
      const obj = evalCore(e.obj, env);
      if (isPlainObj(obj)) {
        const rec = obj as Record<string, Value>;
        if (e.name in rec) return rec[e.name];
      }
      throw new EvalError(`フィールド '${e.name}' が存在しません`);
    }
    case "Do": {
      const doEnv = env.child();
      for (const b of e.binds) {
        const v = evalCore(b.expr, doEnv);
        if (isResult(v) && v.tag === "Err") return v;
        if (b.name !== "_") doEnv.define(b.name, isResult(v) && v.tag === "Ok" ? v.value : v);
      }
      return evalCore(e.body, doEnv);
    }
    case "EffectCall":
      throw new EvalError(`エフェクト '${e.effect}!' は P0 のインタープリタでは実行できません（P1）`);
    case "Error":
      throw new EvalError(e.message);
  }
}

export function globalEnv(): Env {
  return stdlibEnv(applyValue);
}

export function loadDefs(defs: CoreTopForm[], env: Env = globalEnv()): Env {
  for (const d of defs) {
    if (d.k === "defn") {
      const c: Closure = { params: d.params, ret: d.ret, body: d.body, env, name: d.name };
      env.define(d.name, c);
    }
  }
  return env;
}

export interface ExampleResult {
  index: number;
  pass: boolean;
  actual: Value;
  expected: Value;
}

export function runExamples(defs: CoreTopForm[], env: Env): ExampleResult[] {
  const results: ExampleResult[] = [];
  let index = 0;
  for (const d of defs) {
    if (d.k !== "example") continue;
    const actual = evalCore(d.actual, env);
    const expected = evalCore(d.expected, env);
    results.push({ index: index++, pass: structuralEqual(actual, expected), actual, expected });
  }
  return results;
}
