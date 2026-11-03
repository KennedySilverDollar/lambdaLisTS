export type Type =
  | { k: "number" }
  | { k: "string" }
  | { k: "bool" }
  | { k: "nil" }
  | { k: "literal"; value: string }
  | { k: "array"; element: Type }
  | { k: "union"; members: Type[] }
  | { k: "obj"; fields: Map<string, Type> }
  | { k: "result"; ok: Type; err: Type }
  | { k: "fn"; params: Type[]; ret: Type }
  | { k: "var"; id: number }
  | { k: "alias"; name: string };

export type Scheme = { vars: number[]; body: Type };

export type AliasEnv = Map<string, Type>;

export function structuralEqual(a: Type, b: Type): boolean {
  if (a.k !== b.k) return false;
  switch (a.k) {
    case "number":
    case "string":
    case "bool":
    case "nil":
      return true;
    case "literal":
      return b.k === "literal" && a.value === b.value;
    case "var":
      return b.k === "var" && a.id === b.id;
    case "alias":
      return b.k === "alias" && a.name === b.name;
    case "array":
      return b.k === "array" && structuralEqual(a.element, b.element);
    case "union": {
      if (b.k !== "union" || a.members.length !== b.members.length) return false;
      const used = new Array<boolean>(b.members.length).fill(false);
      for (const ma of a.members) {
        let found = false;
        for (let i = 0; i < b.members.length; i++) {
          if (!used[i] && structuralEqual(ma, b.members[i])) {
            used[i] = true;
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
      return true;
    }
    case "obj": {
      if (b.k !== "obj" || a.fields.size !== b.fields.size) return false;
      for (const [k, v] of a.fields) {
        const bv = b.fields.get(k);
        if (bv === undefined || !structuralEqual(v, bv)) return false;
      }
      return true;
    }
    case "result":
      return b.k === "result" && structuralEqual(a.ok, b.ok) && structuralEqual(a.err, b.err);
    case "fn": {
      if (b.k !== "fn" || a.params.length !== b.params.length) return false;
      return a.params.every((p, i) => b.k === "fn" && structuralEqual(p, b.params[i])) && structuralEqual(a.ret, b.ret);
    }
  }
}

export function normalizeUnion(members: Type[], aliases?: AliasEnv): Type[] {
  const out: Type[] = [];
  for (const m of members) {
    if (!out.some((o) => structuralEqual(o, m))) out.push(m);
  }
  out.sort((x, y) => {
    const px = printType(x, aliases);
    const py = printType(y, aliases);
    return px < py ? -1 : px > py ? 1 : 0;
  });
  return out;
}

export function normalizeType(t: Type, aliases: AliasEnv, seen: Set<string> = new Set()): Type {
  switch (t.k) {
    case "alias": {
      if (seen.has(t.name)) return t;
      const def = aliases.get(t.name);
      if (def === undefined) return t;
      seen.add(t.name);
      const r = normalizeType(def, aliases, seen);
      seen.delete(t.name);
      return r;
    }
    case "union": {
      const flat: Type[] = [];
      for (const m of t.members) {
        const n = normalizeType(m, aliases, seen);
        if (n.k === "union") flat.push(...n.members);
        else flat.push(n);
      }
      return { k: "union", members: normalizeUnion(flat, aliases) };
    }
    case "array":
      return { k: "array", element: normalizeType(t.element, aliases, seen) };
    case "obj": {
      const fields = new Map<string, Type>();
      for (const [k, v] of t.fields) fields.set(k, normalizeType(v, aliases, seen));
      return { k: "obj", fields };
    }
    case "result":
      return { k: "result", ok: normalizeType(t.ok, aliases, seen), err: normalizeType(t.err, aliases, seen) };
    case "fn":
      return { k: "fn", params: t.params.map((p) => normalizeType(p, aliases, seen)), ret: normalizeType(t.ret, aliases, seen) };
    default:
      return t;
  }
}

export function findUnresolvedAlias(t: Type): string | null {
  switch (t.k) {
    case "alias":
      return t.name;
    case "array":
      return findUnresolvedAlias(t.element);
    case "union": {
      for (const m of t.members) {
        const r = findUnresolvedAlias(m);
        if (r) return r;
      }
      return null;
    }
    case "obj": {
      for (const v of t.fields.values()) {
        const r = findUnresolvedAlias(v);
        if (r) return r;
      }
      return null;
    }
    case "result":
      return findUnresolvedAlias(t.ok) ?? findUnresolvedAlias(t.err);
    case "fn": {
      for (const p of t.params) {
        const r = findUnresolvedAlias(p);
        if (r) return r;
      }
      return findUnresolvedAlias(t.ret);
    }
    default:
      return null;
  }
}

export function printType(t: Type, aliases?: AliasEnv, seen: Set<string> = new Set()): string {
  switch (t.k) {
    case "number":
    case "string":
    case "bool":
    case "nil":
      return t.k;
    case "literal":
      return JSON.stringify(t.value);
    case "var":
      return `?${t.id}`;
    case "alias": {
      if (aliases) {
        const def = aliases.get(t.name);
        if (def !== undefined && !seen.has(t.name)) {
          seen.add(t.name);
          return printType(normalizeType(def, aliases), aliases, seen);
        }
      }
      return t.name;
    }
    case "array":
      return `(Array ${printType(t.element, aliases, seen)})`;
    case "union": {
      const members = normalizeUnion(t.members, aliases);
      const nonNil = members.filter((m) => m.k !== "nil");
      if (nonNil.length === 1 && members.length === 2) {
        return `(Option ${printType(nonNil[0], aliases, seen)})`;
      }
      return `(union ${members.map((m) => printType(m, aliases, seen)).join(" ")})`;
    }
    case "obj": {
      const fields = [...t.fields.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `(obj ${fields
        .map(([k, v]) => (v.k === "literal" ? `(${k} ${JSON.stringify(v.value)})` : `(${k} : ${printType(v, aliases, seen)})`))
        .join(" ")})`;
    }
    case "result":
      return `(Result ${printType(t.ok, aliases, seen)} ${printType(t.err, aliases, seen)})`;
    case "fn":
      return `(fn (${t.params.map((p) => printType(p, aliases, seen)).join(" ")}) : ${printType(t.ret, aliases, seen)})`;
  }
}
