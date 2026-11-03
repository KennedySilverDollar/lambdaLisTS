import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { desugar } from "../src/core/desugar";
import { checkEffects, findEffectCalls } from "../src/effects/check";
import { tokenize } from "../src/lexer/lexer";
import { parseProgram } from "../src/parser/parser";
import { checkFile, checkSource } from "../src/types/check";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const defsOf = (src: string) => desugar(parseProgram(tokenize(src, "test.lts")).program).defs;

describe("エフェクト検査 (§7.4)", () => {
  test("effects.lts: pure-run 内の log! → effect-violation + defn! replace fix (T6 前段)", () => {
    const r = checkFile(fixturePath("effects.lts"));
    const d = r.diagnostics.find((d) => d.kind === "effect-violation");
    expect(d).toBeDefined();
    expect(d?.severity).toBe("error");
    expect(d?.message).toContain("log!");
    expect(d?.data).toMatchObject({ path: "(defn pure-run)", effect: "log" });
    expect(d?.fix).toMatchObject({ op: "replace", path: "(defn pure-run)", template: "defn!" });
  });

  test("defn! の本体の EffectCall は effect-violation にしない（P0 は宣言のみ受理 §7.5）", () => {
    const r = checkSource(
      "(effect log : (fn (s : string) : nil))\n(defn! f (s : string) : nil (log! s))",
      "test.lts",
    );
    expect(r.diagnostics.filter((d) => d.kind === "effect-violation")).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  test("未宣言エフェクトの呼び出し → unknown-effect (§7.4.3)", () => {
    const r = checkSource(
      "(effect log : (fn (s : string) : nil))\n(defn! f () : nil (db! \"x\"))",
      "test.lts",
    );
    const d = r.diagnostics.find((d) => d.kind === "unknown-effect");
    expect(d).toBeDefined();
    expect(d?.message).toContain("db!");
  });

  test("EffectCall の引数型は宣言と照合 (§7.4.4)", () => {
    const r = checkSource(
      "(effect log : (fn (s : string) : nil))\n(defn! f () : nil (log! 1))",
      "test.lts",
    );
    expect(r.diagnostics.some((d) => d.kind === "type-mismatch")).toBe(true);
  });

  test("findEffectCalls: if/let/match/do のネスト内も検出", () => {
    const defs = defsOf(
      "(defn f (x : number) : number (if (< x 0) (log! \"a\") (let [y (db! \"k\")] (+ x 1))))",
    );
    const d = defs[0];
    if (d.k !== "defn") throw new Error("not defn");
    const sites = findEffectCalls(d.body);
    expect(sites.map((s) => s.effect).sort()).toEqual(["db", "log"]);
    const diags = checkEffects(defs);
    expect(diags).toHaveLength(2);
    expect(diags.every((d) => d.kind === "effect-violation")).toBe(true);
  });

  test("純粋 defn に EffectCall がなければ effect-violation なし", () => {
    const r = checkSource("(defn f (x : number) : number (+ x 1))", "test.lts");
    expect(r.diagnostics).toEqual([]);
  });
});
