import { Env } from "./env.js";
import { EvalError, isResult, printValue, structuralEqual, type Apply, type Builtin, type Value } from "./value.js";

const okV = (value: Value): Value => ({ tag: "Ok", value });
const errV = (value: Value): Value => ({ tag: "Err", value });
const num = (v: Value): number => {
  if (typeof v !== "number") throw new EvalError("number が必要です");
  return v;
};
const strV = (v: Value): string => {
  if (typeof v !== "string") throw new EvalError("string が必要です");
  return v;
};
const arrV = (v: Value): Value[] => {
  if (!Array.isArray(v)) throw new EvalError("Array が必要です");
  return v;
};
const boolV = (v: Value): boolean => {
  if (typeof v !== "boolean") throw new EvalError("bool が必要です");
  return v;
};

export function stdlibEnv(apply: Apply): Env {
  const env = new Env();
  const def = (name: string, fn: (args: Value[]) => Value): void => {
    const b: Builtin = { k: "builtin", name, fn };
    env.define(name, b);
  };

  def("+", (a) => num(a[0]) + num(a[1]));
  def("-", (a) => num(a[0]) - num(a[1]));
  def("*", (a) => num(a[0]) * num(a[1]));
  def("/", (a) => num(a[0]) / num(a[1]));
  def("<", (a) => num(a[0]) < num(a[1]));
  def(">", (a) => num(a[0]) > num(a[1]));
  def("<=", (a) => num(a[0]) <= num(a[1]));
  def(">=", (a) => num(a[0]) >= num(a[1]));
  def("=", (a) => structuralEqual(a[0], a[1]));
  def("mod", (a) => num(a[0]) % num(a[1]));
  def("abs", (a) => Math.abs(num(a[0])));
  def("min", (a) => Math.min(num(a[0]), num(a[1])));
  def("max", (a) => Math.max(num(a[0]), num(a[1])));
  def("not", (a) => !boolV(a[0]));
  def("str", (a) => printValue(a[0]));
  def("str-concat", (a) => a.map(strV).join(""));
  def("str-slice", (a) => strV(a[0]).slice(num(a[1]), num(a[2])));
  def("len", (a) => strV(a[0]).length);
  def("contains?", (a) => strV(a[0]).includes(strV(a[1])));
  def("split", (a) => strV(a[0]).split(strV(a[1])));
  def("array", (a) => [...a]);
  def("nth", (a) => {
    const arr = arrV(a[0]);
    const i = num(a[1]);
    return i >= 0 && i < arr.length ? okV(arr[i]) : null;
  });
  def("count", (a) => arrV(a[0]).length);
  def("slice", (a) => arrV(a[0]).slice(num(a[1]), num(a[2])));
  def("push", (a) => [...arrV(a[0]), a[1]]);
  def("concat", (a) => [...arrV(a[0]), ...arrV(a[1])]);
  def("map", (a) => arrV(a[0]).map((x) => apply(a[1], [x])));
  def("filter", (a) => arrV(a[0]).filter((x) => boolV(apply(a[1], [x]))));
  def("fold-left", (a) => arrV(a[0]).reduce((acc, x) => apply(a[2], [acc, x]), a[1]));
  def("find", (a) => {
    for (const x of arrV(a[0])) if (boolV(apply(a[1], [x]))) return okV(x);
    return null;
  });
  def("any?", (a) => arrV(a[0]).some((x) => boolV(apply(a[1], [x]))));
  def("all?", (a) => arrV(a[0]).every((x) => boolV(apply(a[1], [x]))));
  def("ok", (a) => okV(a[0]));
  def("err", (a) => errV(a[0]));
  def("bind", (a) => {
    const r = a[0];
    return isResult(r) && r.tag === "Ok" ? apply(a[1], [r.value]) : r;
  });
  def("map-result", (a) => {
    const r = a[0];
    return isResult(r) && r.tag === "Ok" ? okV(apply(a[1], [r.value])) : r;
  });
  def("traverse", (a) => {
    const out: Value[] = [];
    for (const x of arrV(a[0])) {
      const r = apply(a[1], [x]);
      if (isResult(r) && r.tag === "Err") return r;
      out.push(isResult(r) && r.tag === "Ok" ? r.value : r);
    }
    return okV(out);
  });

  return env;
}
