import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CoreTopForm } from "../core/desugar.js";
import { desugar } from "../core/desugar.js";
import type { Core, Pattern, Value } from "../core/ir.js";
import type { Diagnostic } from "../diagnostic.js";
import type { Span } from "../lexer/token.js";
import { tokenize } from "../lexer/lexer.js";
import { parseProgram } from "../parser/parser.js";
import { applySubst, prune, unify, type Subst } from "./unify.js";
import {
  findUnresolvedAlias,
  normalizeType,
  normalizeUnion,
  printType,
  type AliasEnv,
  type Scheme,
  type Type,
} from "./type.js";
import { stdlibSchemes } from "./stdlib.js";

export interface ModuleCache {
  modules: Map<string, ModuleResult>;
  visiting: Set<string>;
}

export function newModuleCache(): ModuleCache {
  return { modules: new Map(), visiting: new Set() };
}

export interface ModuleResult {
  diagnostics: Diagnostic[];
  valueTypes: Map<string, Type>;
  typeAliases: AliasEnv;
  effects: Map<string, Type>;
  exports: string[];
}

const BOOL: Type = { k: "bool" };
const STR: Type = { k: "string" };

const VARIADIC: Record<string, "string" | "fresh"> = {
  "str-concat": "string",
  array: "fresh",
};

export function checkProgram(defs: CoreTopForm[], file: string, cache: ModuleCache = newModuleCache()): ModuleResult {
  return new Checker(file, cache).run(defs, cache);
}

export function checkSource(src: string, file: string, cache: ModuleCache = newModuleCache()): ModuleResult {
  const parsed = parseProgram(tokenize(src, file));
  const ds = desugar(parsed.program);
  const res = checkProgram(ds.defs, file, cache);
  res.diagnostics = [...parsed.diagnostics, ...res.diagnostics];
  return res;
}

export function checkFile(path: string, cache: ModuleCache = newModuleCache()): ModuleResult {
  return checkSource(readFileSync(path, "utf8"), path, cache);
}

export function typeOfAll(result: ModuleResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, t] of result.valueTypes) {
    out.set(name, printType(normalizeType(t, result.typeAliases), result.typeAliases));
  }
  return out;
}

class Checker {
  readonly diagnostics: Diagnostic[] = [];
  readonly subst: Subst = new Map();
  readonly aliases: AliasEnv = new Map();
  readonly values = new Map<string, Type>();
  readonly effects = new Map<string, Type>();
  private scope: Map<string, Type>[] = [];
  private nextVarId = 1;

  constructor(private file: string, private cache: ModuleCache) {}

  run(defs: CoreTopForm[], cache: ModuleCache): ModuleResult {
    const exports: string[] = [];
    for (const d of defs) {
      if (d.k === "type") {
        if (this.aliases.has(d.name)) {
          this.diag("duplicate-definition", d.span, `型 '${d.name}' は既に定義されています`, { path: d.path });
          continue;
        }
        this.aliases.set(d.name, d.type);
      }
    }
    for (const d of defs) {
      switch (d.k) {
        case "import":
          this.loadImport(d, cache);
          break;
        case "export":
          exports.push(...d.names);
          break;
        case "type":
          break;
        case "effect": {
          if (this.effects.has(d.name) || this.values.has(d.name)) {
            this.diag("duplicate-definition", d.span, `値名前空間の '${d.name}' は既に定義されています`, { path: d.path });
            break;
          }
          this.effects.set(d.name, this.resolve(d.type, d.span, `${d.path}.type`));
          break;
        }
        case "defn":
          this.checkDefn(d);
          break;
        case "example": {
          const actual = this.infer(d.actual, `${d.path}.args.0`);
          const expected = this.infer(d.expected, `${d.path}.args.2`);
          if (!unify(actual, expected, this.subst, this.aliases)) {
            this.typeMismatch(d.span, d.path, expected, actual);
          }
          break;
        }
        case "prop": {
          const params = d.params.map((p) => this.resolve(p.type, d.span, `${d.path}.params`));
          this.scope.push(new Map(d.params.map((p, i) => [p.name, params[i]])));
          this.check(d.body, BOOL, `${d.path}.body`);
          this.scope.pop();
          break;
        }
        case "error":
          this.diag("parse-error", d.span, d.message, { path: d.path });
          break;
      }
    }
    return {
      diagnostics: this.diagnostics,
      valueTypes: this.values,
      typeAliases: this.aliases,
      effects: this.effects,
      exports,
    };
  }

  private loadImport(d: Extract<CoreTopForm, { k: "import" }>, cache: ModuleCache): void {
    if (!d.path.startsWith("./") && !d.path.startsWith("../")) return;
    const target = resolve(dirname(this.file), d.path);
    if (cache.visiting.has(target)) {
      this.diag("module-cycle", d.span, `循環 import です: '${d.path}'`, { path: d.path });
      return;
    }
    let mod = cache.modules.get(target);
    if (!mod) {
      cache.visiting.add(target);
      try {
        mod = checkSource(readFileSync(target, "utf8"), target, cache);
      } catch {
        cache.visiting.delete(target);
        this.diag("import-not-found", d.span, `import 先が見つかりません: '${d.path}'`, { path: d.path });
        return;
      }
      cache.visiting.delete(target);
      cache.modules.set(target, mod);
    }
    for (const name of d.names) {
      const vt = mod.valueTypes.get(name);
      if (vt !== undefined) {
        this.values.set(name, vt);
        continue;
      }
      const tt = mod.typeAliases.get(name);
      if (tt !== undefined) {
        this.aliases.set(name, tt);
        continue;
      }
      const et = mod.effects.get(name);
      if (et !== undefined) {
        this.effects.set(name, et);
        continue;
      }
      this.diag("unbound-symbol", d.span, `モジュール '${d.path}' に '${name}' が存在しません`, { path: d.path });
    }
  }

  private checkDefn(d: Extract<CoreTopForm, { k: "defn" }>): void {
    if (this.values.has(d.name) || this.effects.has(d.name)) {
      this.diag("duplicate-definition", d.span, `値名前空間の '${d.name}' は既に定義されています`, { path: d.path });
      return;
    }
    const paramTypes = d.params.map((p, i) => this.resolve(p.type, d.span, `${d.path}.params.${i}`));
    const ret = this.resolve(d.ret, d.span, `${d.path}.ret`);
    this.values.set(d.name, { k: "fn", params: paramTypes, ret });
    this.scope.push(new Map(d.params.map((p, i) => [p.name, paramTypes[i]])));
    this.check(d.body, ret, `${d.path}.body`);
    this.scope.pop();
  }

  private fresh(): Type {
    return { k: "var", id: this.nextVarId++ };
  }

  private instantiate(scheme: Scheme): Type {
    const map = new Map<number, Type>();
    for (const id of scheme.vars) map.set(id, this.fresh());
    const rename = (t: Type): Type => {
      if (t.k === "var") return map.get(t.id) ?? t;
      if (t.k === "array") return { k: "array", element: rename(t.element) };
      if (t.k === "union") return { k: "union", members: t.members.map(rename) };
      if (t.k === "obj") {
        const fields = new Map<string, Type>();
        for (const [k, v] of t.fields) fields.set(k, rename(v));
        return { k: "obj", fields };
      }
      if (t.k === "result") return { k: "result", ok: rename(t.ok), err: rename(t.err) };
      if (t.k === "fn") return { k: "fn", params: t.params.map(rename), ret: rename(t.ret) };
      return t;
    };
    return rename(scheme.body);
  }

  private lookupValue(name: string): Type | null {
    for (let i = this.scope.length - 1; i >= 0; i--) {
      const t = this.scope[i].get(name);
      if (t !== undefined) return t;
    }
    const v = this.values.get(name);
    if (v !== undefined) return v;
    const scheme = stdlibSchemes.get(name);
    if (scheme) return this.instantiate(scheme);
    return null;
  }

  private resolve(t: Type, span: Span, path: string): Type {
    const n = normalizeType(t, this.aliases);
    const unresolved = findUnresolvedAlias(n);
    if (unresolved !== null) {
      this.diag("type-syntax-error", span, `未定義の型です: '${unresolved}'`, { path });
    }
    return n;
  }

  private diag(kind: string, span: Span, message: string, data?: object, fix?: Diagnostic["fix"]): void {
    this.diagnostics.push({ kind, severity: "error", span, message, data, fix });
  }

  private typeMismatch(span: Span, path: string, expected: Type, actual: Type): void {
    const exp = printType(expected, this.aliases);
    const act = printType(applySubst(actual, this.subst), this.aliases);
    this.diag(
      "type-mismatch",
      span,
      `型が一致しません: 期待 ${exp}、実際 ${act}`,
      { path, expected: exp, actual: act },
      { op: "replace", path, template: printType(expected) },
    );
  }

  private litType(value: Value): Type {
    if (value === null) return { k: "nil" };
    if (typeof value === "number") return { k: "number" };
    if (typeof value === "string") return { k: "string" };
    return { k: "bool" };
  }

  infer(e: Core, path: string): Type {
    switch (e.k) {
      case "Lit":
        return this.litType(e.value);
      case "Var": {
        if (e.name === "_") {
          this.diag("unbound-symbol", e.span, "'_' に束縛された値は参照できません", { path });
          return { k: "nil" };
        }
        const t = this.lookupValue(e.name);
        if (t === null) {
          this.diag("unbound-symbol", e.span, `未定義のシンボルです: '${e.name}'`, { path });
          return { k: "nil" };
        }
        return t;
      }
      case "Lam": {
        const params = e.params.map((p, i) => this.resolve(p.type, e.span, `${path}.params.${i}`));
        const ret = this.resolve(e.ret, e.span, `${path}.ret`);
        this.scope.push(new Map(e.params.map((p, i) => [p.name, params[i]])));
        this.check(e.body, ret, `${path}.body`);
        this.scope.pop();
        return { k: "fn", params, ret };
      }
      case "App": {
        if (e.fn.k === "Var" && e.fn.name in VARIADIC) {
          const name = e.fn.name as keyof typeof VARIADIC;
          const param = VARIADIC[name] === "string" ? STR : this.fresh();
          for (let i = 0; i < e.args.length; i++) this.check(e.args[i], param, `${path}.args.${i}`);
          return name === "array" ? { k: "array", element: applySubst(param, this.subst) } : STR;
        }
        const ft = prune(this.infer(e.fn, `${path}.fn`), this.subst);
        if (ft.k !== "fn") {
          this.typeMismatch(e.span, path, { k: "fn", params: e.args.map(() => this.fresh()), ret: this.fresh() }, ft);
          return { k: "nil" };
        }
        if (ft.params.length !== e.args.length) {
          this.diag(
            "arity-mismatch",
            e.span,
            `引数の数が一致しません: 期待 ${ft.params.length}、実際 ${e.args.length}`,
            { path, expected: ft.params.length, actual: e.args.length },
            { op: "replace", path, template: printType(ft) },
          );
          return { k: "nil" };
        }
        for (let i = 0; i < e.args.length; i++) {
          this.check(e.args[i], ft.params[i], `${path}.args.${i}`);
        }
        return applySubst(ft.ret, this.subst);
      }
      case "Let": {
        const t = this.infer(e.rhs, `${path}.rhs`);
        this.scope.push(new Map([[e.name, t]]));
        const r = this.infer(e.body, `${path}.body`);
        this.scope.pop();
        return r;
      }
      case "If": {
        this.check(e.cond, BOOL, `${path}.cond`);
        const t1 = this.infer(e.then, `${path}.then`);
        const t2 = this.infer(e.else, `${path}.else`);
        if (!unify(t1, t2, this.subst, this.aliases)) {
          this.typeMismatch(e.span, path, t1, t2);
        }
        return applySubst(t1, this.subst);
      }
      case "Field": {
        const ot = prune(this.infer(e.obj, `${path}.obj`), this.subst);
        return this.fieldType(ot, e.name, e.span, path);
      }
      case "Obj": {
        const fields = new Map<string, Type>();
        for (let i = 0; i < e.fields.length; i++) {
          const [name, expr] = e.fields[i];
          if (fields.has(name)) {
            this.diag("type-syntax-error", e.span, `obj のフィールド '${name}' が重複しています`, { path: `${path}.fields.${i}` });
            continue;
          }
          fields.set(name, this.infer(expr, `${path}.fields.${i}`));
        }
        return { k: "obj", fields };
      }
      case "Do": {
        const res = { k: "result", ok: this.fresh(), err: this.fresh() } as Type;
        this.doCheck(e, res, path);
        return applySubst(res, this.subst);
      }
      case "Match": {
        const st = this.infer(e.scrutinee, `${path}.scrutinee`);
        let result: Type | null = null;
        this.eachMatchArm(e, st, path, (armPath, binds, body) => {
          this.scope.push(binds);
          const bt = this.infer(body, armPath);
          this.scope.pop();
          if (result === null) result = bt;
          else if (!unify(result, bt, this.subst, this.aliases)) this.typeMismatch(e.span, path, result, bt);
        });
        return result ?? { k: "nil" };
      }
      case "EffectCall": {
        const sig = this.effects.get(e.effect);
        if (sig === undefined) {
          this.diag("unknown-effect", e.span, `未宣言のエフェクトです: '${e.effect}!'`, { path });
          return { k: "nil" };
        }
        const f = prune(sig, this.subst);
        if (f.k !== "fn") {
          this.typeMismatch(e.span, path, { k: "fn", params: e.args.map(() => this.fresh()), ret: this.fresh() }, f);
          return { k: "nil" };
        }
        if (f.params.length !== e.args.length) {
          this.diag("arity-mismatch", e.span, `エフェクト '${e.effect}!' の引数が一致しません: 期待 ${f.params.length}、実際 ${e.args.length}`, { path, expected: f.params.length, actual: e.args.length });
          return { k: "nil" };
        }
        for (let i = 0; i < e.args.length; i++) this.check(e.args[i], f.params[i], `${path}.args.${i}`);
        return applySubst(f.ret, this.subst);
      }
      case "Error":
        this.diag("parse-error", e.span, e.message, { path });
        return { k: "nil" };
    }
  }

  check(e: Core, expected: Type, path: string): void {
    const exp = prune(expected, this.subst);
    switch (e.k) {
      case "Lam": {
        const params = e.params.map((p, i) => this.resolve(p.type, e.span, `${path}.params.${i}`));
        if (exp.k === "fn" && exp.params.length === e.params.length) {
          for (let i = 0; i < params.length; i++) {
            if (!unify(params[i], exp.params[i], this.subst, this.aliases)) {
              this.typeMismatch(e.span, `${path}.params.${i}`, exp.params[i], params[i]);
            }
          }
          this.scope.push(new Map(e.params.map((p, i) => [p.name, exp.params[i]])));
          this.check(e.body, exp.ret, `${path}.body`);
          this.scope.pop();
          return;
        }
        const t = this.infer(e, path);
        if (!unify(t, expected, this.subst, this.aliases)) this.typeMismatch(e.span, path, expected, t);
        return;
      }
      case "If":
        this.check(e.cond, BOOL, `${path}.cond`);
        this.check(e.then, expected, `${path}.then`);
        this.check(e.else, expected, `${path}.else`);
        return;
      case "Let": {
        const t = this.infer(e.rhs, `${path}.rhs`);
        this.scope.push(new Map([[e.name, t]]));
        this.check(e.body, expected, `${path}.body`);
        this.scope.pop();
        return;
      }
      case "Do":
        this.doCheck(e, expected, path);
        return;
      case "Match": {
        const st = this.infer(e.scrutinee, `${path}.scrutinee`);
        this.eachMatchArm(e, st, path, (armPath, binds, body) => {
          this.scope.push(binds);
          this.check(body, expected, armPath);
          this.scope.pop();
        });
        return;
      }
      default: {
        const t = this.infer(e, path);
        if (!unify(t, expected, this.subst, this.aliases)) this.typeMismatch(e.span, path, expected, t);
      }
    }
  }

  private doCheck(e: Extract<Core, { k: "Do" }>, expected: Type, path: string): void {
    let exp = prune(expected, this.subst);
    if (exp.k === "alias") exp = prune(normalizeType(exp, this.aliases), this.subst);
    if (exp.k === "var") {
      this.subst.set(exp.id, { k: "result", ok: this.fresh(), err: this.fresh() });
      exp = prune(expected, this.subst);
    }
    if (exp.k !== "result") {
      this.typeMismatch(e.span, path, { k: "result", ok: this.fresh(), err: this.fresh() }, expected);
      return;
    }
    const errT = exp.err;
    const binds = new Map<string, Type>();
    this.scope.push(binds);
    for (let i = 0; i < e.binds.length; i++) {
      const b = e.binds[i];
      const ti = prune(this.infer(b.expr, `${path}.binds.${i}`), this.subst);
      if (ti.k !== "result") {
        this.typeMismatch(e.span, `${path}.binds.${i}`, { k: "result", ok: this.fresh(), err: errT }, ti);
        continue;
      }
      if (!unify(ti, { k: "result", ok: ti.ok, err: errT }, this.subst, this.aliases)) {
        this.typeMismatch(e.span, `${path}.binds.${i}`, { k: "result", ok: ti.ok, err: errT }, ti);
      }
      if (b.name !== "_") binds.set(b.name, applySubst(ti.ok, this.subst));
    }
    this.check(e.body, exp, `${path}.body`);
    this.scope.pop();
  }

  private eachMatchArm(
    e: Extract<Core, { k: "Match" }>,
    scrutinee: Type,
    path: string,
    visit: (armPath: string, binds: Map<string, Type>, body: Core) => void,
  ): void {
    const s = prune(scrutinee, this.subst);
    let remaining: Type[] | null = s.k === "union" ? [...s.members] : null;
    for (let i = 0; i < e.arms.length; i++) {
      const arm = e.arms[i];
      const armPath = `${path}.arms.${i}`;
      let target = s;
      if (remaining !== null) {
        if (arm.pattern.k === "var" || arm.pattern.k === "wildcard") {
          target = { k: "union", members: normalizeUnion(remaining, this.aliases) };
          remaining = [];
        } else {
          const hit = remaining.findIndex((m) => this.matchPattern(arm.pattern, m, true, e.span, armPath) !== null);
          if (hit >= 0) {
            target = remaining[hit];
            remaining.splice(hit, 1);
          } else {
            remaining = [];
          }
        }
      }
      const binds = this.matchPattern(arm.pattern, target, false, e.span, armPath) ?? new Map<string, Type>();
      visit(armPath, binds, arm.body);
    }
  }

  private matchPattern(p: Pattern, scrut: Type, quiet: boolean, span: Span, path: string): Map<string, Type> | null {
    const s = prune(scrut, this.subst);
    const fail = (expected: Type, actual: Type): null => {
      if (!quiet) this.typeMismatch(span, path, expected, actual);
      return null;
    };
    switch (p.k) {
      case "wildcard":
        return new Map();
      case "var":
        return new Map([[p.name, s]]);
      case "lit": {
        const pt: Type =
          p.value === null
            ? { k: "nil" }
            : typeof p.value === "string"
              ? { k: "literal", value: p.value }
              : typeof p.value === "number"
                ? { k: "number" }
                : { k: "bool" };
        if (!unify(pt, s, this.subst, this.aliases)) return fail(pt, s);
        return new Map();
      }
      case "obj": {
        if (s.k !== "obj") return fail({ k: "obj", fields: new Map(p.fields.map(([n]) => [n, this.fresh()])) }, s);
        const binds = new Map<string, Type>();
        for (const [name, sub] of p.fields) {
          const ft = s.fields.get(name);
          if (ft === undefined) return fail({ k: "obj", fields: new Map([[name, this.fresh()]]) }, s);
          const subBinds = this.matchPattern(sub, ft, quiet, span, `${path}.${name}`);
          if (subBinds === null) return null;
          for (const [k, val] of subBinds) binds.set(k, val);
        }
        return binds;
      }
      case "array": {
        if (s.k !== "array") return fail({ k: "array", element: this.fresh() }, s);
        const binds = new Map<string, Type>();
        for (const el of p.elements) {
          const subBinds = this.matchPattern(el, s.element, quiet, span, path);
          if (subBinds === null) return null;
          for (const [k, val] of subBinds) binds.set(k, val);
        }
        return binds;
      }
      case "or": {
        for (const sub of p.patterns) {
          const b = this.matchPattern(sub, s, true, span, path);
          if (b !== null) return b;
        }
        return fail(s, s);
      }
    }
  }

  private fieldType(ot: Type, name: string, span: Span, path: string): Type {
    if (ot.k === "union") {
      const types: Type[] = [];
      for (const m of ot.members) {
        if (m.k === "obj" && m.fields.has(name)) {
          types.push(m.fields.get(name)!);
        } else {
          this.diag("type-mismatch", span, `フィールド '${name}' が ${printType(m, this.aliases)} にはありません`, { path });
        }
      }
      if (types.length === 0) return { k: "nil" };
      return types.length === 1 ? types[0] : { k: "union", members: normalizeUnion(types, this.aliases) };
    }
    if (ot.k === "obj") {
      const ft = ot.fields.get(name);
      if (ft === undefined) {
        this.typeMismatch(span, path, { k: "obj", fields: new Map([[name, this.fresh()]]) }, ot);
        return { k: "nil" };
      }
      return ft;
    }
    this.typeMismatch(span, path, { k: "obj", fields: new Map([[name, this.fresh()]]) }, ot);
    return { k: "nil" };
  }
}
