import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { checkFile, checkSource, typeOfAll } from "../src/types/check";
import { normalizeType, normalizeUnion, printType, type AliasEnv, type Type } from "../src/types/type";
import { unify, type Subst } from "../src/types/unify";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const T = {
  num: { k: "number" } as Type,
  str: { k: "string" } as Type,
  bool: { k: "bool" } as Type,
  nil: { k: "nil" } as Type,
  lit: (s: string): Type => ({ k: "literal", value: s }),
  v: (id: number): Type => ({ k: "var", id }),
  arr: (el: Type): Type => ({ k: "array", element: el }),
  union: (...ms: Type[]): Type => ({ k: "union", members: ms }),
  obj: (fields: Record<string, Type>): Type => ({ k: "obj", fields: new Map(Object.entries(fields)) }),
  res: (ok: Type, err: Type): Type => ({ k: "result", ok, err }),
  fn: (params: Type[], ret: Type): Type => ({ k: "fn", params, ret }),
};
const U = (a: Type, b: Type, subst: Subst = new Map(), aliases: AliasEnv = new Map()) =>
  unify(a, b, subst, aliases);

describe("unify (§6.4)", () => {
  test("構造的同一・プリミティブ", () => {
    expect(U(T.num, T.num)).toBe(true);
    expect(U(T.num, T.str)).toBe(false);
    expect(U(T.res(T.num, T.str), T.res(T.num, T.str))).toBe(true);
    expect(U(T.fn([T.num], T.bool), T.fn([T.num], T.bool))).toBe(true);
    expect(U(T.fn([T.num], T.bool), T.fn([T.num, T.num], T.bool))).toBe(false);
  });

  test("リテラル型: lit s vs lit s / lit s vs string", () => {
    expect(U(T.lit("A"), T.lit("A"))).toBe(true);
    expect(U(T.lit("A"), T.lit("B"))).toBe(false);
    expect(U(T.lit("A"), T.str)).toBe(true);
    expect(U(T.str, T.lit("A"))).toBe(true);
  });

  test("unify(T, union): いずれかのメンバーと unify 可", () => {
    expect(U(T.num, T.union(T.str, T.num))).toBe(true);
    expect(U(T.num, T.union(T.str, T.bool))).toBe(false);
  });

  test("unify(unionA, unionB): A ⊆ B", () => {
    const a = T.union(T.num, T.str);
    const b = T.union(T.num, T.str, T.bool);
    expect(U(a, b)).toBe(true);
    expect(U(b, a)).toBe(false);
  });

  test("obj は幅部分型: obj2 の全フィールドが obj1 に存在して unify", () => {
    const wide = T.obj({ a: T.num, b: T.str });
    const narrow = T.obj({ a: T.num });
    expect(U(wide, narrow)).toBe(true);
    expect(U(narrow, wide)).toBe(false);
    expect(U(T.obj({ a: T.num }), T.obj({ a: T.str }))).toBe(false);
  });

  test("var: bind + occurs check", () => {
    const subst: Subst = new Map();
    expect(U(T.v(1), T.num, subst)).toBe(true);
    expect(subst.get(1)).toEqual(T.num);
    expect(U(T.v(2), T.arr(T.v(2)), new Map())).toBe(false);
    const s2: Subst = new Map();
    expect(U(T.v(1), T.arr(T.num), s2)).toBe(true);
    expect(U(T.v(1), T.arr(T.num), s2)).toBe(true);
    expect(U(T.v(1), T.str, s2)).toBe(false);
  });

  test("array / alias 展開", () => {
    expect(U(T.arr(T.num), T.arr(T.num))).toBe(true);
    expect(U(T.arr(T.num), T.arr(T.str))).toBe(false);
    const aliases: AliasEnv = new Map([["Money", T.obj({ amount: T.num })]]);
    expect(U({ k: "alias", name: "Money" }, T.obj({ amount: T.num }), new Map(), aliases)).toBe(true);
    expect(U({ k: "alias", name: "Money" }, T.obj({ amount: T.str }), new Map(), aliases)).toBe(false);
  });
});

describe("normalizeUnion / printType (§6.2)", () => {
  test("重複除去 + 正規表示バイト列順ソート、nil は保持", () => {
    const ms = normalizeUnion([T.str, T.num, T.str, T.nil]);
    expect(ms.map((m) => printType(m))).toEqual(["nil", "number", "string"]);
  });

  test("printType: 正規表示", () => {
    expect(printType(T.num)).toBe("number");
    expect(printType(T.lit("EmptyCart"))).toBe('"EmptyCart"');
    expect(printType(T.arr(T.num))).toBe("(Array number)");
    expect(printType(T.res(T.num, T.str))).toBe("(Result number string)");
    expect(printType(T.union(T.num, T.nil))).toBe("(Option number)");
    expect(printType(T.union(T.num, T.str, T.nil))).toBe("(union nil number string)");
    expect(printType(T.obj({ b: T.str, a: T.num }))).toBe("(obj (a : number) (b : string))");
    expect(printType(T.fn([T.num, T.str], T.bool))).toBe("(fn (number string) : bool)");
    expect(printType(T.fn([], T.num))).toBe("(fn () : number)");
    expect(printType(T.v(7))).toBe("?7");
  });

  test("printType: エイリアスは展開済みの正規表示（env あり）/ 名前のまま（env なし）", () => {
    const aliases: AliasEnv = new Map([["Money", T.obj({ amount: T.num, currency: T.str })]]);
    expect(printType({ k: "alias", name: "Money" }, aliases)).toBe("(obj (amount : number) (currency : string))");
    expect(printType({ k: "alias", name: "Money" })).toBe("Money");
  });

  test("normalizeType: union のネストを平坦化する", () => {
    const aliases: AliasEnv = new Map([["E", T.union(T.obj({ tag: T.lit("A") }), T.obj({ tag: T.lit("B") }))]]);
    const n = normalizeType(T.union({ k: "alias", name: "E" }, T.str), aliases);
    expect(printType(n, aliases)).toBe('(union (obj (tag "A")) (obj (tag "B")) string)');
  });
});

describe("付録A: 型検査ゼロ診断 + type-of ゴールデン", () => {
  test("money.lts", () => {
    const r = checkFile(fixturePath("money.lts"));
    expect(r.diagnostics).toEqual([]);
    const types = typeOfAll(r);
    expect(types.get("zero")).toBe("(fn () : (obj (amount : number) (currency : string)))");
    expect(types.get("add-money")).toBe(
      "(fn ((obj (amount : number) (currency : string)) (obj (amount : number) (currency : string))) : (Result (obj (amount : number) (currency : string)) string))",
    );
    expect(Object.fromEntries(types)).toMatchSnapshot();
  });

  test("cart.lts（import + do のエラー型 unify + match）も診断ゼロ", () => {
    const r = checkFile(fixturePath("cart.lts"));
    expect(r.diagnostics).toEqual([]);
    const types = typeOfAll(r);
    expect(types.get("place-order")).toBe(
      "(fn ((Array (obj (id : string) (price : (obj (amount : number) (currency : string))) (qty : number)))) : (Result (obj (amount : number) (currency : string)) (union (obj (id : string) (tag \"NegativeQty\")) (obj (tag \"EmptyCart\")) string)))",
    );
    expect(Object.fromEntries(types)).toMatchSnapshot();
  });
});

describe("失敗ケースのゴールデン診断", () => {
  test("(ok \"a\") を number 期待で check → type-mismatch + expected/actual + fix", () => {
    const r = checkSource('(defn f () : number (ok "a"))', "test.lts");
    expect(r.diagnostics).toHaveLength(1);
    const d = r.diagnostics[0];
    expect(d.kind).toBe("type-mismatch");
    expect(d.data).toMatchObject({ expected: "number", path: "(defn f).body" });
    expect((d.data as { actual: string }).actual).toContain("(Result string");
    expect(d.fix).toMatchObject({ op: "replace", path: "(defn f).body", template: "number" });
    expect(r.diagnostics).toMatchSnapshot();
  });

  test("unbound-symbol", () => {
    const r = checkSource("(defn f () : number g)", "test.lts");
    expect(r.diagnostics.some((d) => d.kind === "unbound-symbol" && d.message.includes("'g'"))).toBe(true);
  });

  test("duplicate-definition（値名前空間）", () => {
    const r = checkSource("(defn f () : number 1)\n(defn f () : number 2)", "test.lts");
    expect(r.diagnostics.some((d) => d.kind === "duplicate-definition")).toBe(true);
  });

  test("型と値は別名前空間: type Money と defn money は共存できる (§6.6)", () => {
    const r = checkSource("(type Money (obj (amount : number)))\n(defn money () : Money (obj (amount 1)))", "test.lts");
    expect(r.diagnostics).toEqual([]);
  });

  test("arity-mismatch", () => {
    const r = checkSource("(defn f () : number (+ 1))", "test.lts");
    const d = r.diagnostics.find((d) => d.kind === "arity-mismatch");
    expect(d).toBeDefined();
    expect(d?.data).toMatchObject({ expected: 2, actual: 1 });
  });

  test("type-syntax-error: 未定義の型", () => {
    const r = checkSource("(defn f () : Foo 1)", "test.lts");
    expect(r.diagnostics.some((d) => d.kind === "type-syntax-error" && d.message.includes("Foo"))).toBe(true);
  });

  test("do は check モード限定: 期待型が Result でなければ type-mismatch", () => {
    const r = checkSource("(defn f () : number (do [_ (ok 1)] (ok 2)))", "test.lts");
    expect(r.diagnostics.some((d) => d.kind === "type-mismatch")).toBe(true);
  });

  test("do の bind エラー型が期待の E と unify されないと type-mismatch", () => {
    const r = checkSource(
      "(defn f () : (Result number string) (do [_ (err 1)] (ok 2)))",
      "test.lts",
    );
    expect(r.diagnostics.some((d) => d.kind === "type-mismatch")).toBe(true);
  });
});
