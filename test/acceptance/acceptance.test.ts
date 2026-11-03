import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { emit } from "../../src/backend/js";
import { normalizeSource, tokenize } from "../../src/lexer/lexer";
import { parseProgram } from "../../src/parser/parser";
import { checkFile } from "../../src/types/check";
import { compileToDir, fixturePath, newTmpDir, pipelineFile, runNode } from "./harness";

describe("T1: 純粋関数と Result（付録A add-money の JS 実行値）", () => {
  test("add_money を生成JSで呼び、期待値を返す", () => {
    const dir = newTmpDir("lists-t1-");
    compileToDir(["money.lts"], dir);
    writeFileSync(
      join(dir, "driver.js"),
      `import { add_money } from "./money.js";
console.log("R1 " + JSON.stringify(add_money({ amount: 1, currency: "JPY" }, { amount: 2, currency: "JPY" })));
console.log("R2 " + JSON.stringify(add_money({ amount: 1, currency: "JPY" }, { amount: 2, currency: "USD" })));
`,
    );
    const r = runNode("driver.js", dir);
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n");
    const r1 = JSON.parse(lines.find((l) => l.startsWith("R1 "))!.slice(3));
    const r2 = JSON.parse(lines.find((l) => l.startsWith("R2 "))!.slice(3));
    expect(r1).toEqual({ tag: "Ok", value: { amount: 3, currency: "JPY" } });
    expect(r2.tag).toBe("Err");
    expect(r2.value).toBe("currency mismatch: JPY vs USD");
  });
});

describe("T2: 網羅性検査（stock.lts）", () => {
  test("non-exhaustive エラー + 不足アームの fix テンプレート（診断JSONゴールデン）", () => {
    const res = checkFile(fixturePath("stock.lts"));
    const d = res.diagnostics.find((d) => d.kind === "non-exhaustive");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("error");
    expect(d!.fix).toMatchObject({ op: "insert", path: "(defn show-error).body.arms" });
    expect((d!.data as { missing: string[] }).missing).toEqual(['(obj (tag "OutOfStock"))']);
    const template = d!.fix && "template" in d!.fix ? d!.fix.template : "";
    expect(template).toContain('[(obj (tag "OutOfStock")) "..."]');
    expect(res.diagnostics).toMatchSnapshot();
  });
});

describe("T3: do > 早期リターン（呼び出し回数の検証）", () => {
  test("check-items が Err のとき total は呼ばれない（JS 側エラーハッチ）", () => {
    expect(checkFile(fixturePath("cart-spy.lts")).diagnostics).toEqual([]);
    const dir = newTmpDir("lists-t3-");
    compileToDir(["money.lts", "cart-spy.lts"], dir);
    const r = runNode("cart-spy.js", dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("example 0: ok");
    expect(r.stdout).toContain('"tag":"EmptyCart"');
    expect(r.stdout).not.toContain("TOTAL-WAS-CALLED");
  });
});

describe("T4: モジュール", () => {
  test("money.lts / cart.lts が import して型検査ゼロ + 実行できる", () => {
    expect(checkFile(fixturePath("money.lts")).diagnostics).toEqual([]);
    expect(checkFile(fixturePath("cart.lts")).diagnostics).toEqual([]);
    const dir = newTmpDir("lists-t4-");
    compileToDir(["money.lts", "cart.lts"], dir);
    const r = runNode("cart.js", dir);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("example 0: ok");
    expect(r.stdout).toContain('"tag":"Err"');
  });

  test("cycle-a/b は module-cycle エラー", () => {
    for (const n of ["cycle-a.lts", "cycle-b.lts"]) {
      const res = checkFile(fixturePath(n));
      expect(res.diagnostics.some((d) => d.kind === "module-cycle"), n).toBe(true);
    }
  });
});

describe("T5: パーサ回復（broken.lts）", () => {
  test("broken にのみ parse-error、ok は正常ノード。emit は errors を返す", () => {
    const abs = fixturePath("broken.lts");
    const source = normalizeSource(readFileSync(abs, "utf8"));
    const parsed = parseProgram(tokenize(source, abs));
    const forms = parsed.program.forms;
    expect(forms).toHaveLength(2);
    expect(forms[0].k).toBe("defn");
    if (forms[0].k === "defn") {
      expect(forms[0].name).toBe("broken");
      expect(forms[0].body.k).toBe("error");
    }
    expect(forms[1].k).toBe("defn");
    if (forms[1].k === "defn") {
      expect(forms[1].name).toBe("ok");
      expect(forms[1].body.k).toBe("app");
    }
    expect(parsed.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(parsed.diagnostics.every((d) => d.kind === "parse-error")).toBe(true);
    const okStart = forms[1].span.start;
    expect(parsed.diagnostics.every((d) => d.span.end <= okStart)).toBe(true);

    const p = pipelineFile(abs);
    const r = emit({ defs: p.defs, source: p.source, file: "broken.js", sourceFile: "broken.lts" });
    expect("errors" in r).toBe(true);
    if ("errors" in r) {
      expect(r.errors.some((d) => d.kind === "parse-error")).toBe(true);
    }
  });
});

describe("T6: エフェクト違反（検査のみ）", () => {
  test("effects.lts: pure-run 内 log! → effect-violation + defn! への fix（診断JSONゴールデン）", () => {
    const res = checkFile(fixturePath("effects.lts"));
    const d = res.diagnostics.find((d) => d.kind === "effect-violation");
    expect(d).toBeDefined();
    expect(d!.message).toContain("log!");
    expect(d!.fix).toEqual({ op: "replace", path: "(defn pure-run)", template: "defn!" });
    expect(res.diagnostics).toMatchSnapshot();
  });
});
