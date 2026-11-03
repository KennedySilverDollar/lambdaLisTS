import type { Scheme, Type } from "./type.js";

const v = (id: number): Type => ({ k: "var", id });
const num: Type = { k: "number" };
const str: Type = { k: "string" };
const bool: Type = { k: "bool" };
const nilT: Type = { k: "nil" };
const fn = (params: Type[], ret: Type): Type => ({ k: "fn", params, ret });
const arr = (el: Type): Type => ({ k: "array", element: el });
const res = (ok: Type, err: Type): Type => ({ k: "result", ok, err });
const opt = (t: Type): Type => ({ k: "union", members: [t, nilT] });

export const stdlibSchemes: ReadonlyMap<string, Scheme> = new Map<string, Scheme>([
  ["+", { vars: [], body: fn([num, num], num) }],
  ["-", { vars: [], body: fn([num, num], num) }],
  ["*", { vars: [], body: fn([num, num], num) }],
  ["/", { vars: [], body: fn([num, num], num) }],
  ["<", { vars: [], body: fn([num, num], bool) }],
  [">", { vars: [], body: fn([num, num], bool) }],
  ["<=", { vars: [], body: fn([num, num], bool) }],
  [">=", { vars: [], body: fn([num, num], bool) }],
  ["=", { vars: [1], body: fn([v(1), v(1)], bool) }],
  ["mod", { vars: [], body: fn([num, num], num) }],
  ["abs", { vars: [], body: fn([num], num) }],
  ["min", { vars: [], body: fn([num, num], num) }],
  ["max", { vars: [], body: fn([num, num], num) }],
  ["not", { vars: [], body: fn([bool], bool) }],
  ["str", { vars: [1], body: fn([v(1)], str) }],
  ["str-concat", { vars: [], body: fn([str, str], str) }],
  ["str-slice", { vars: [], body: fn([str, num, num], str) }],
  ["len", { vars: [], body: fn([str], num) }],
  ["contains?", { vars: [], body: fn([str, str], bool) }],
  ["split", { vars: [], body: fn([str, str], arr(str)) }],
  ["array", { vars: [1], body: fn([v(1), v(1)], arr(v(1))) }],
  ["nth", { vars: [1], body: fn([arr(v(1)), num], opt(v(1))) }],
  ["count", { vars: [1], body: fn([arr(v(1))], num) }],
  ["slice", { vars: [1], body: fn([arr(v(1)), num, num], arr(v(1))) }],
  ["push", { vars: [1], body: fn([arr(v(1)), v(1)], arr(v(1))) }],
  ["concat", { vars: [1], body: fn([arr(v(1)), arr(v(1))], arr(v(1))) }],
  ["map", { vars: [1, 2], body: fn([arr(v(1)), fn([v(1)], v(2))], arr(v(2))) }],
  ["filter", { vars: [1], body: fn([arr(v(1)), fn([v(1)], bool)], arr(v(1))) }],
  ["fold-left", { vars: [1, 2], body: fn([arr(v(1)), v(2), fn([v(2), v(1)], v(2))], v(2)) }],
  ["find", { vars: [1], body: fn([arr(v(1)), fn([v(1)], bool)], opt(v(1))) }],
  ["any?", { vars: [1], body: fn([arr(v(1)), fn([v(1)], bool)], bool) }],
  ["all?", { vars: [1], body: fn([arr(v(1)), fn([v(1)], bool)], bool) }],
  ["ok", { vars: [1, 2], body: fn([v(1)], res(v(1), v(2))) }],
  ["err", { vars: [1, 2], body: fn([v(2)], res(v(1), v(2))) }],
  ["bind", { vars: [1, 2, 3], body: fn([res(v(1), v(2)), fn([v(1)], res(v(3), v(2)))], res(v(3), v(2))) }],
  ["map-result", { vars: [1, 2, 3], body: fn([res(v(1), v(2)), fn([v(1)], v(3))], res(v(3), v(2))) }],
  ["traverse", { vars: [1, 2, 3], body: fn([arr(v(1)), fn([v(1)], res(v(3), v(2)))], res(arr(v(3)), v(2))) }],
]);
