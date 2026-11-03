import { normalizeType, type AliasEnv, type Type } from "./type.js";

export type Subst = Map<number, Type>;

export function prune(t: Type, subst: Subst): Type {
  let cur = t;
  while (cur.k === "var") {
    const next = subst.get(cur.id);
    if (next === undefined) return cur;
    cur = next;
  }
  return cur;
}

export function occurs(id: number, t: Type, subst: Subst): boolean {
  const p = prune(t, subst);
  switch (p.k) {
    case "var":
      return p.id === id;
    case "array":
      return occurs(id, p.element, subst);
    case "union":
      return p.members.some((m) => occurs(id, m, subst));
    case "obj":
      return [...p.fields.values()].some((v) => occurs(id, v, subst));
    case "result":
      return occurs(id, p.ok, subst) || occurs(id, p.err, subst);
    case "fn":
      return p.params.some((x) => occurs(id, x, subst)) || occurs(id, p.ret, subst);
    default:
      return false;
  }
}

export function applySubst(t: Type, subst: Subst): Type {
  const p = prune(t, subst);
  switch (p.k) {
    case "var":
      return p;
    case "array":
      return { k: "array", element: applySubst(p.element, subst) };
    case "union":
      return { k: "union", members: p.members.map((m) => applySubst(m, subst)) };
    case "obj": {
      const fields = new Map<string, Type>();
      for (const [k, v] of p.fields) fields.set(k, applySubst(v, subst));
      return { k: "obj", fields };
    }
    case "result":
      return { k: "result", ok: applySubst(p.ok, subst), err: applySubst(p.err, subst) };
    case "fn":
      return { k: "fn", params: p.params.map((x) => applySubst(x, subst)), ret: applySubst(p.ret, subst) };
    default:
      return p;
  }
}

function tryUnify(a: Type, b: Type, subst: Subst, aliases: AliasEnv): boolean {
  const snap = new Map(subst);
  if (unify(a, b, subst, aliases)) return true;
  subst.clear();
  for (const [k, v] of snap) subst.set(k, v);
  return false;
}

export function unify(a0: Type, b0: Type, subst: Subst, aliases: AliasEnv): boolean {
  let a = prune(a0, subst);
  let b = prune(b0, subst);
  if (a.k === "alias") a = prune(normalizeType(a, aliases), subst);
  if (b.k === "alias") b = prune(normalizeType(b, aliases), subst);

  if (a.k === "var") {
    if (b.k === "var" && a.id === b.id) return true;
    if (occurs(a.id, b, subst)) return false;
    subst.set(a.id, b);
    return true;
  }
  if (b.k === "var") {
    if (occurs(b.id, a, subst)) return false;
    subst.set(b.id, a);
    return true;
  }
  if (a.k === "union") {
    if (b.k === "union") {
      for (const ma of a.members) {
        if (!b.members.some((mb) => tryUnify(ma, mb, subst, aliases))) return false;
      }
      return true;
    }
    return a.members.some((ma) => tryUnify(ma, b, subst, aliases));
  }
  if (b.k === "union") {
    return b.members.some((mb) => tryUnify(a, mb, subst, aliases));
  }
  if (a.k !== b.k) {
    if (a.k === "literal" && b.k === "string") return true;
    if (a.k === "string" && b.k === "literal") return true;
    return false;
  }
  switch (a.k) {
    case "number":
    case "string":
    case "bool":
    case "nil":
      return true;
    case "literal":
      return b.k === "literal" && a.value === b.value;
    case "array":
      return b.k === "array" && unify(a.element, b.element, subst, aliases);
    case "obj":
      return (
        b.k === "obj" &&
        [...b.fields.entries()].every(([k, bv]) => {
          const av = a.fields.get(k);
          return av !== undefined && unify(av, bv, subst, aliases);
        })
      );
    case "result":
      return b.k === "result" && unify(a.ok, b.ok, subst, aliases) && unify(a.err, b.err, subst, aliases);
    case "fn":
      return (
        b.k === "fn" &&
        a.params.length === b.params.length &&
        a.params.every((p, i) => b.k === "fn" && unify(p, b.params[i], subst, aliases)) &&
        unify(a.ret, b.ret, subst, aliases)
      );
    case "alias":
      return false;
  }
}
