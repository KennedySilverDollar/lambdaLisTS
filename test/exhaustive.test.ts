import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { Pattern } from "../src/core/ir";
import { printPattern } from "../src/parser/ast";
import { checkFile, checkSource } from "../src/types/check";
import { checkExhaustive } from "../src/types/exhaustive";
import { normalizeType, type AliasEnv, type Type } from "../src/types/type";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const T = {
  num: { k: "number" } as Type,
  str: { k: "string" } as Type,
  bool: { k: "bool" } as Type,
  nil: { k: "nil" } as Type,
  lit: (s: string): Type => ({ k: "literal", value: s }),
  arr: (el: Type): Type => ({ k: "array", element: el }),
  union: (...ms: Type[]): Type => ({ k: "union", members: ms }),
  obj: (fields: Record<string, Type>): Type => ({ k: "obj", fields: new Map(Object.entries(fields)) }),
};
const P = {
  wild: { k: "wildcard" } as Pattern,
  v: (name: string): Pattern => ({ k: "var", name }),
  lit: (value: string | number | boolean | null): Pattern => ({ k: "lit", value }),
  obj: (fields: [string, Pattern][]): Pattern => ({ k: "obj", fields }),
  arr: (...els: Pattern[]): Pattern => ({ k: "array", elements: els }),
  or: (...ps: Pattern[]): Pattern => ({ k: "or", patterns: ps }),
};
const tagObj = (tag: string, extra: Record<string, Type> = {}): Type =>
  T.obj({ tag: T.lit(tag), ...extra });
const tagPat = (tag: string, extra: [string, Pattern][] = []): Pattern =>
  P.obj([["tag", P.lit(tag)], ...extra]);

describe("checkExhaustive 単体 (§6.5)", () => {
  const aliases: AliasEnv = new Map();
  const run = (t: Type, arms: Pattern[]) => checkExhaustive(t, arms, new Map(), aliases);

  test("判別union: タグ列挙の全カバー", () => {
    const e = T.union(tagObj("A"), tagObj("B"));
    const r = run(e, [tagPat("A"), tagPat("B")]);
    expect(r.missing).toEqual([]);
    expect(r.redundant).toEqual([]);
  });

  test("判別union: タグ過不足 → missing に不足パターン", () => {
    const e = T.union(tagObj("A"), tagObj("B"));
    const r = run(e, [tagPat("A")]);
    expect(r.missing.map(printPattern)).toEqual(['(obj (tag "B"))']);
  });

  test("or パターンで網羅", () => {
    const e = T.union(tagObj("A"), tagObj("B"));
    const r = run(e, [P.or(tagPat("A"), tagPat("B"))]);
    expect(r.missing).toEqual([]);
  });

  test("ワイルドカード/変数は全カバー (union(CartItem, nil) の [nil][i])", () => {
    const e = T.union(T.obj({ id: T.str }), T.nil);
    const r = run(e, [P.lit(null), P.v("i")]);
    expect(r.missing).toEqual([]);
  });

  test("bool: [true][false] は網羅、[true] のみなら false が不足", () => {
    expect(run(T.bool, [P.lit(true), P.lit(false)]).missing).toEqual([]);
    expect(run(T.bool, [P.lit(true)]).missing.map(printPattern)).toEqual(["false"]);
  });

  test("Array パターンは全配列をカバーしない → non-exhaustive", () => {
    const r = run(T.arr(T.num), [P.arr(P.v("x"))]);
    expect(r.missing.map(printPattern)).toEqual(["_"]);
  });

  test("冗長アーム検出: [true][false][true] の3つ目", () => {
    const r = run(T.bool, [P.lit(true), P.lit(false), P.lit(true)]);
    expect(r.missing).toEqual([]);
    expect(r.redundant).toEqual([2]);
  });

  test("冗長アーム: [x][true] の2つ目", () => {
    const r = run(T.bool, [P.v("x"), P.lit(true)]);
    expect(r.redundant).toEqual([1]);
  });

  test("obj フィールドの tag 以外のフィールドも minimal pattern に含める", () => {
    const e = T.union(tagObj("A"), tagObj("B", { "new-price": T.num }));
    const r = run(e, [tagPat("A")]);
    expect(r.missing.map(printPattern)).toEqual(['(obj (tag "B") (new-price _))']);
  });
});

describe("統合: fixtures とソース (§6.5)", () => {
  test("stock.lts: OutOfStock アーム欠落 → non-exhaustive + insert fix テンプレート", () => {
    const r = checkFile(fixturePath("stock.lts"));
    const d = r.diagnostics.find((d) => d.kind === "non-exhaustive");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect((d?.data as { missing: string[] }).missing).toEqual(['(obj (tag "OutOfStock"))']);
    expect(d?.fix).toMatchObject({ op: "insert", path: "(defn show-error).body.arms" });
    const template = d?.fix && "template" in d.fix ? d.fix.template : "";
    expect(template).toContain('[(obj (tag "OutOfStock")) "..."]');
    expect(r.diagnostics.filter((d) => d.kind === "redundant-arm")).toEqual([]);
  });

  test("cart.lts: check-items の [nil][i] で union(CartItem, nil) は網羅 → non-exhaustive なし", () => {
    const r = checkFile(fixturePath("cart.lts"));
    expect(r.diagnostics.filter((d) => d.kind === "non-exhaustive")).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  test("ソース: タグ全カバーは診断ゼロ", () => {
    const r = checkSource(
      '(type E (union (obj (tag "A")) (obj (tag "B")))) (defn f (e : E) : number (match e [(obj (tag "A")) 1] [(obj (tag "B")) 2]))',
      "test.lts",
    );
    expect(r.diagnostics).toEqual([]);
  });

  test("ソース: タグ部分カバー → non-exhaustive、fix に不足アーム", () => {
    const r = checkSource(
      '(type E (union (obj (tag "A")) (obj (tag "B")))) (defn f (e : E) : number (match e [(obj (tag "A")) 1]))',
      "test.lts",
    );
    const d = r.diagnostics.find((d) => d.kind === "non-exhaustive");
    expect(d).toBeDefined();
    expect((d?.data as { missing: string[] }).missing).toEqual(['(obj (tag "B"))']);
    expect(d?.fix && "template" in d.fix ? d.fix.template : "").toContain('[(obj (tag "B")) "..."]');
  });

  test("ソース: 冗長アームは warning + delete fix", () => {
    const r = checkSource(
      "(defn f (x : bool) : bool (match x [true true] [false false] [true 0]))",
      "test.lts",
    );
    const d = r.diagnostics.find((d) => d.kind === "redundant-arm");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("warning");
    expect(d?.fix).toMatchObject({ op: "delete", path: "(defn f).body.arms.2" });
  });

  test("ソース: Array パターンのみでは網羅にならない", () => {
    const r = checkSource(
      "(defn f (xs : (Array number)) : number (match xs [(Array x) x]))",
      "test.lts",
    );
    expect(r.diagnostics.some((d) => d.kind === "non-exhaustive")).toBe(true);
  });

  test("printPattern: core Pattern の文字列化", () => {
    expect(printPattern(P.wild)).toBe("_");
    expect(printPattern(P.v("p"))).toBe("p");
    expect(printPattern(P.lit("A"))).toBe('"A"');
    expect(printPattern(P.lit(null))).toBe("nil");
    expect(printPattern(tagPat("PriceChanged", [["new-price", P.v("p")]]))).toBe('(obj (tag "PriceChanged") (new-price p))');
    expect(printPattern(P.arr(P.v("x"), P.wild))).toBe("(Array x _)");
    expect(printPattern(P.or(P.lit(1), P.wild))).toBe("(or 1 _)");
  });
});
