import type { Pattern, Value } from "../core/ir.js";
import { normalizeType, type AliasEnv, type Type } from "./type.js";
import { prune, unify, type Subst } from "./unify.js";

export interface ExhaustiveResult {
  missing: Pattern[];
  redundant: number[];
}

type Case = { kind: "value"; value: Value } | { kind: "type"; type: Type };

function litTypeOf(value: Value): Type {
  if (value === null) return { k: "nil" };
  if (typeof value === "string") return { k: "literal", value };
  if (typeof value === "number") return { k: "number" };
  return { k: "bool" };
}

function casesOf(t: Type, subst: Subst, aliases: AliasEnv): Case[] {
  const tt = prune(normalizeType(t, aliases), subst);
  switch (tt.k) {
    case "union":
      return tt.members.flatMap((m) => casesOf(m, subst, aliases));
    case "bool":
      return [
        { kind: "value", value: true },
        { kind: "value", value: false },
      ];
    case "nil":
      return [{ kind: "value", value: null }];
    case "literal":
      return [{ kind: "value", value: tt.value }];
    default:
      return [{ kind: "type", type: tt }];
  }
}

function caseType(c: Case, subst: Subst, aliases: AliasEnv): Type | null {
  if (c.kind === "value") return litTypeOf(c.value);
  return prune(normalizeType(c.type, aliases), subst);
}

function patternMatchesCase(p: Pattern, c: Case, subst: Subst, aliases: AliasEnv): boolean {
  switch (p.k) {
    case "wildcard":
    case "var":
      return true;
    case "lit": {
      if (c.kind === "value") return p.value === c.value;
      const ct = caseType(c, subst, aliases);
      return ct !== null && unify(litTypeOf(p.value), ct, subst, aliases);
    }
    case "or":
      return p.patterns.some((sub) => patternMatchesCase(sub, c, subst, aliases));
    case "obj": {
      if (c.kind === "value") return false;
      const t = prune(normalizeType(c.type, aliases), subst);
      if (t.k !== "obj") return false;
      return p.fields.every(([n, sub]) => {
        const ft = t.fields.get(n);
        return ft !== undefined && patternMatchesCase(sub, { kind: "type", type: ft }, subst, aliases);
      });
    }
    case "array": {
      if (c.kind === "value") return false;
      const t = prune(normalizeType(c.type, aliases), subst);
      return (
        t.k === "array" &&
        p.elements.every((el) => patternMatchesCase(el, { kind: "type", type: t.element }, subst, aliases))
      );
    }
  }
}

function patternCoversCase(p: Pattern, c: Case, subst: Subst, aliases: AliasEnv): boolean {
  switch (p.k) {
    case "wildcard":
    case "var":
      return true;
    case "lit": {
      if (c.kind === "value") return p.value === c.value;
      const ct = caseType(c, subst, aliases);
      if (ct === null) return false;
      if (p.value === null) return ct.k === "nil";
      if (typeof p.value === "string") return ct.k === "literal" && ct.value === p.value;
      return false;
    }
    case "or":
      return p.patterns.some((sub) => patternCoversCase(sub, c, subst, aliases));
    case "obj": {
      if (c.kind === "value") return false;
      const t = prune(normalizeType(c.type, aliases), subst);
      if (t.k !== "obj") return false;
      return p.fields.every(([n, sub]) => {
        const ft = t.fields.get(n);
        return ft !== undefined && patternCoversCase(sub, { kind: "type", type: ft }, subst, aliases);
      });
    }
    case "array":
      return false;
  }
}

function caseToPattern(c: Case): Pattern {
  if (c.kind === "value") return { k: "lit", value: c.value };
  switch (c.type.k) {
    case "literal":
      return { k: "lit", value: c.type.value };
    case "obj":
      return {
        k: "obj",
        fields: [...c.type.fields.entries()].map(([n, ft]) => [n, caseToPattern({ kind: "type", type: ft })] as [string, Pattern]),
      };
    case "union":
      return { k: "or", patterns: c.type.members.map((m) => caseToPattern({ kind: "type", type: m })) };
    default:
      return { k: "wildcard" };
  }
}

function patternEqual(a: Pattern, b: Pattern): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "wildcard":
      return true;
    case "var":
      return b.k === "var" && a.name === b.name;
    case "lit":
      return b.k === "lit" && a.value === b.value;
    case "obj": {
      if (b.k !== "obj" || a.fields.length !== b.fields.length) return false;
      return a.fields.every(([n, sub], i) => {
        const [bn, bsub] = b.fields[i];
        return n === bn && patternEqual(sub, bsub);
      });
    }
    case "array":
      return b.k === "array" && a.elements.length === b.elements.length && a.elements.every((e, i) => b.k === "array" && patternEqual(e, b.elements[i]));
    case "or":
      return b.k === "or" && a.patterns.length === b.patterns.length && a.patterns.every((s, i) => b.k === "or" && patternEqual(s, b.patterns[i]));
  }
}

function patternsEqual(a: Pattern[], b: Pattern[]): boolean {
  return a.length === b.length && a.every((p, i) => patternEqual(p, b[i]));
}

function missingCases(t: Type, arms: Pattern[], subst: Subst, aliases: AliasEnv): Pattern[] {
  const cases = casesOf(t, subst, aliases);
  const out: Pattern[] = [];
  for (const c of cases) {
    if (!arms.some((a) => patternCoversCase(a, c, subst, aliases))) {
      const p = caseToPattern(c);
      if (!out.some((o) => patternEqual(o, p))) out.push(p);
    }
  }
  return out;
}

export function checkExhaustive(scrutinee: Type, arms: Pattern[], subst: Subst, aliases: AliasEnv): ExhaustiveResult {
  const snap = new Map(subst);
  const missing = missingCases(scrutinee, arms, subst, aliases);
  const redundant: number[] = [];
  for (let i = 1; i < arms.length; i++) {
    const before = missingCases(scrutinee, arms.slice(0, i), subst, aliases);
    const after = missingCases(scrutinee, arms.slice(0, i + 1), subst, aliases);
    if (patternsEqual(before, after)) redundant.push(i);
  }
  subst.clear();
  for (const [k, v] of snap) subst.set(k, v);
  return { missing, redundant };
}
