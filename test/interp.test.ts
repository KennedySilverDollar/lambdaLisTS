import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { CoreTopForm } from "../src/core/desugar";
import { desugar } from "../src/core/desugar";
import { Env } from "../src/interp/env";
import { applyValue, globalEnv, loadDefs, runExamples } from "../src/interp/eval";
import { isResult, structuralEqual, type Builtin, type Value } from "../src/interp/value";
import { tokenize } from "../src/lexer/lexer";
import { resolveImportPath } from "../src/modules/resolver";
import { parseProgram } from "../src/parser/parser";
import { checkFile } from "../src/types/check";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const defsOf = (src: string, file = "test.lts"): CoreTopForm[] =>
  desugar(parseProgram(tokenize(src, file)).program).defs;

const loadFile = (absPath: string, env: Env, seen = new Set<string>()): CoreTopForm[] => {
  if (seen.has(absPath)) return [];
  seen.add(absPath);
  const src = readFileSync(absPath, "utf8");
  const defs = desugar(parseProgram(tokenize(src, absPath)).program).defs;
  for (const d of defs) {
    if (d.k === "import") {
      const target = resolveImportPath(absPath, d.path);
      if (target) loadFile(target, env, seen);
    }
  }
  loadDefs(defs, env);
  return defs;
};

const callSrc = (src: string, fn: string, args: Value[]): Value => {
  const env = loadDefs(defsOf(src));
  const f = env.lookup(fn);
  if (f === undefined) throw new Error(`${fn} が未定義です`);
  return applyValue(f, args);
};

const builtin = (name: string, fn: (args: Value[]) => Value): Value => {
  const b: Builtin = { k: "builtin", name, fn };
  return b;
};

describe("付録A の example 実行 (§8, §13 T1/T3)", () => {
  test("money.lts の example が全て pass（add-money の期待値）", () => {
    const env = globalEnv();
    const defs = loadFile(fixturePath("money.lts"), env);
    const results = runExamples(defs, env);
    expect(results).toHaveLength(1);
    expect(results[0].pass).toBe(true);
    expect(results[0].actual).toEqual({ tag: "Ok", value: { amount: 3, currency: "JPY" } });
  });

  test("cart.lts の example: place-order 空カート → (err (obj (tag \"EmptyCart\")))", () => {
    const env = globalEnv();
    const defs = loadFile(fixturePath("cart.lts"), env);
    const results = runExamples(defs, env);
    expect(results).toHaveLength(1);
    expect(results[0].pass).toBe(true);
    expect(structuralEqual(results[0].actual, { tag: "Err", value: { tag: "EmptyCart" } })).toBe(true);
  });

  test("add-money: 通貨一致 → Ok、不一致 → Err", () => {
    const env = loadFile2Env("money.lts");
    const addMoney = env.lookup("add-money")!;
    expect(applyValue(addMoney, [{ amount: 1, currency: "JPY" }, { amount: 2, currency: "JPY" }])).toEqual({
      tag: "Ok",
      value: { amount: 3, currency: "JPY" },
    });
    const r = applyValue(addMoney, [{ amount: 1, currency: "JPY" }, { amount: 2, currency: "USD" }]);
    expect(isResult(r) && r.tag === "Err").toBe(true);
    expect(isResult(r) && r.value).toBe("currency mismatch: JPY vs USD");
  });

  function loadFile2Env(name: string): Env {
    const env = globalEnv();
    loadFile(fixturePath(name), env);
    return env;
  }
});

describe("do の早期リターン (§8.4, T3 前段)", () => {
  test("check-items が Err なら total は呼ばれず、その Err が返る", () => {
    const env = globalEnv();
    loadFile(fixturePath("cart.lts"), env);
    env.define("check-items", builtin("check-items", () => ({ tag: "Err", value: { tag: "EmptyCart" } })));
    let totalCalls = 0;
    env.define(
      "total",
      builtin("total", () => {
        totalCalls++;
        return { tag: "Ok", value: { amount: 0, currency: "JPY" } };
      }),
    );
    const placeOrder = env.lookup("place-order")!;
    const r = applyValue(placeOrder, [[]]);
    expect(totalCalls).toBe(0);
    expect(isResult(r) && r.tag === "Err").toBe(true);
    expect(isResult(r) && r.value).toEqual({ tag: "EmptyCart" });
  });

  test("check-items が Ok なら total は呼ばれ、本体が評価される", () => {
    const env = globalEnv();
    loadFile(fixturePath("cart.lts"), env);
    env.define("check-items", builtin("check-items", () => ({ tag: "Ok", value: null })));
    let totalCalls = 0;
    env.define(
      "total",
      builtin("total", () => {
        totalCalls++;
        return { tag: "Ok", value: { amount: 42, currency: "JPY" } };
      }),
    );
    const placeOrder = env.lookup("place-order")!;
    const r = applyValue(placeOrder, [[]]);
    expect(totalCalls).toBe(1);
    expect(r).toEqual({ tag: "Ok", value: { amount: 42, currency: "JPY" } });
  });
});

describe("評価規則 (§8.1)", () => {
  test("match: スカラティニーを1度だけ評価し、パターンに合うアームへ", () => {
    expect(callSrc('(defn f (x : number) : string (match x [0 "zero"] [n (str-concat "n=" (str n))]))', "f", [0])).toBe("zero");
    expect(callSrc('(defn f (x : number) : string (match x [0 "zero"] [n (str-concat "n=" (str n))]))', "f", [3])).toBe("n=3");
    expect(
      callSrc('(defn g (e : (obj (tag : string))) : string (match e [(obj (tag "EmptyCart")) "empty"] [_ "other"]))', "g", [{ tag: "EmptyCart" }]),
    ).toBe("empty");
    expect(
      callSrc('(defn g (e : (obj (tag : string))) : string (match e [(obj (tag "EmptyCart")) "empty"] [_ "other"]))', "g", [{ tag: "X" }]),
    ).toBe("other");
  });

  test("and/or は短絡（未定義シンボルを評価しない）", () => {
    expect(callSrc("(defn f () : bool (and false boom))", "f", [])).toBe(false);
    expect(callSrc("(defn f () : bool (or true boom))", "f", [])).toBe(true);
    expect(callSrc("(defn f () : bool (and true false))", "f", [])).toBe(false);
    expect(callSrc("(defn f () : bool (or false true))", "f", [])).toBe(true);
  });

  test("let / if / フィールドアクセス / obj 構築", () => {
    expect(callSrc("(defn f () : number (let [a 1 b 2] (+ a b)))", "f", [])).toBe(3);
    expect(callSrc('(defn f () : string (if true "yes" "no"))', "f", [])).toBe("yes");
    expect(callSrc("(defn f (o : (obj (a : number) (b : number))) : number o.a)", "f", [{ a: 10, b: 20 }])).toBe(10);
    expect(callSrc("(defn g () : number (-> (obj (a 1)) (fn (o : (obj (a : number))) : number o.a)))", "g", [])).toBe(1);
  });

  test("(/ 1 0) は Infinity、(/ 0 0) は NaN（例外にしない §8.6）", () => {
    expect(callSrc("(defn f () : number (/ 1 0))", "f", [])).toBe(Infinity);
    expect(callSrc("(defn f () : number (/ 0 0))", "f", [])).toBeNaN();
  });
});

describe("再帰", () => {
  test("fact.lts: fact(5) = 120（型検査もゼロ診断）", () => {
    expect(checkFile(fixturePath("fact.lts")).diagnostics).toEqual([]);
    const env = globalEnv();
    loadFile(fixturePath("fact.lts"), env);
    expect(applyValue(env.lookup("fact")!, [5])).toBe(120);
    expect(applyValue(env.lookup("fact")!, [0])).toBe(1);
  });
});

describe("structuralEqual (§8.3)", () => {
  test("プリミティブ: NaN は NaN と等しくない", () => {
    expect(structuralEqual(1, 1)).toBe(true);
    expect(structuralEqual(NaN, NaN)).toBe(false);
    expect(structuralEqual("a", "a")).toBe(true);
    expect(structuralEqual(true, false)).toBe(false);
    expect(structuralEqual(null, null)).toBe(true);
    expect(structuralEqual(1, "1")).toBe(false);
  });

  test("配列は長さと各要素の再帰的等価", () => {
    expect(structuralEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(structuralEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(structuralEqual([1, [2, 3]], [1, [2, 4]])).toBe(false);
  });

  test("obj はキー集合と各値の再帰的等価（キー順は不問）", () => {
    expect(structuralEqual({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(structuralEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(structuralEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  test("Result は tag と value が等しい", () => {
    expect(structuralEqual({ tag: "Ok", value: 1 }, { tag: "Ok", value: 1 })).toBe(true);
    expect(structuralEqual({ tag: "Ok", value: 1 }, { tag: "Err", value: 1 })).toBe(false);
    expect(structuralEqual({ tag: "Err", value: { tag: "EmptyCart" } }, { tag: "Err", value: { tag: "EmptyCart" } })).toBe(true);
    expect(structuralEqual({ tag: "EmptyCart" }, { tag: "Ok", value: null })).toBe(false);
  });
});
