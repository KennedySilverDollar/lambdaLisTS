import type { Core, Param } from "../core/ir.js";
import type { Type } from "../types/type.js";
import type { Env } from "./env.js";

export type Apply = (fn: Value, args: Value[]) => Value;

export interface Closure {
  params: Param[];
  ret: Type;
  body: Core;
  env: Env;
  name: string | null;
}

export interface Builtin {
  k: "builtin";
  name: string;
  fn: (args: Value[]) => Value;
}

export type Value =
  | number
  | string
  | boolean
  | null
  | Value[]
  | { [key: string]: Value }
  | { tag: "Ok"; value: Value }
  | { tag: "Err"; value: Value }
  | Closure
  | Builtin;

export class EvalError extends Error {}

export function isBuiltin(v: Value): v is Builtin {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "k" in v && (v as Builtin).k === "builtin";
}

export function isClosure(v: Value): v is Closure {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    "params" in v &&
    "body" in v &&
    "env" in v
  );
}

export function isResult(v: Value): v is { tag: "Ok" | "Err"; value: Value } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !isBuiltin(v) &&
    !isClosure(v) &&
    ((v as { tag?: unknown }).tag === "Ok" || (v as { tag?: unknown }).tag === "Err") &&
    "value" in v
  );
}

export function isPlainObj(v: Value): v is { [key: string]: Value } {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !isResult(v) && !isBuiltin(v) && !isClosure(v);
}

export function structuralEqual(a: Value, b: Value): boolean {
  if (isBuiltin(a) || isBuiltin(b) || isClosure(a) || isClosure(b)) return a === b;
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => structuralEqual(x, (b as Value[])[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ra = isResult(a);
    const rb = isResult(b);
    if (ra || rb) {
      return (
        ra &&
        rb &&
        (a as { tag: string }).tag === (b as { tag: string }).tag &&
        structuralEqual((a as { value: Value }).value, (b as { value: Value }).value)
      );
    }
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) => k in b && structuralEqual((a as Record<string, Value>)[k], (b as Record<string, Value>)[k]),
    );
  }
  return a === b;
}

export function printValue(v: Value): string {
  if (v === null) return "nil";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(printValue).join(" ")}]`;
  if (isResult(v)) return `(${v.tag === "Ok" ? "ok" : "err"} ${printValue(v.value)})`;
  if (isPlainObj(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${k}: ${printValue(v[k])}`)
      .join(", ")}}`;
  }
  return String(v);
}
