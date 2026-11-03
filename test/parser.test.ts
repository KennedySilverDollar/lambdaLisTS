import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { tokenize } from "../src/lexer/lexer";
import type { Defn, If, Match, Program, TypeDef } from "../src/parser/ast";
import { parseProgram } from "../src/parser/parser";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const parseSrc = (src: string) => parseProgram(tokenize(src, "test.lts"));
const parseFixture = (name: string) => parseProgram(tokenize(fixture(name), name));

const asDefn = (p: Program, name: string): Defn => {
  const f = p.forms.find((f) => f.k === "defn" && (f as Defn).name === name);
  if (!f || f.k !== "defn") throw new Error(`defn ${name} が見つかりません`);
  return f;
};

describe("付録A: money.lts / cart.lts が診断ゼロでパースできる (§3)", () => {
  test("money.lts", () => {
    const r = parseFixture("money.lts");
    expect(r.diagnostics).toEqual([]);
    expect(r.program.forms.map((f) => f.k)).toEqual(["typeDef", "export", "defn", "defn", "example", "prop"]);
    const money = r.program.forms[0] as TypeDef;
    expect(money.name).toBe("Money");
    expect(money.type.k).toBe("obj");
    const zero = asDefn(r.program, "zero");
    expect(zero.params).toEqual([]);
    expect(zero.ret).toMatchObject({ k: "alias", name: "Money" });
    expect(zero.body.k).toBe("obj");
    const add = asDefn(r.program, "add-money");
    expect(add.effect).toBe(false);
    expect(add.params.map((p) => p.name)).toEqual(["a", "b"]);
    expect(add.ret).toMatchObject({ k: "result" });
    expect(add.body.k).toBe("if");
  });

  test("cart.lts", () => {
    const r = parseFixture("cart.lts");
    expect(r.diagnostics).toEqual([]);
    expect(r.program.forms.map((f) => f.k)).toEqual([
      "import", "typeDef", "typeDef", "typeDef", "export", "defn", "defn", "defn", "example",
    ]);
    const imp = r.program.forms[0];
    expect(imp).toMatchObject({ k: "import", path: "./money.lts", names: ["Money", "add-money", "zero"] });
    const placeOrder = asDefn(r.program, "place-order");
    expect(placeOrder.body.k).toBe("do");
    if (placeOrder.body.k === "do") {
      expect(placeOrder.body.binds.map((b) => b.name)).toEqual(["_", "t"]);
      expect(placeOrder.body.body).toMatchObject({ k: "app", fn: "ok" });
    }
    const checkItems = asDefn(r.program, "check-items");
    const ifNode = checkItems.body as If;
    expect(ifNode.else.k).toBe("match");
    const match = ifNode.else as Match;
    expect(match.arms).toHaveLength(2);
    expect(match.arms[0].pattern).toMatchObject({ k: "plit", litKind: "nil" });
    expect(match.arms[1].pattern).toMatchObject({ k: "pvar", name: "i" });
  });
});

describe("付録B: fixtures のパース", () => {
  test("broken.lts: broken にのみ parse-error、ok は正常ノード (T5 前段, §9.4)", () => {
    const r = parseFixture("broken.lts");
    expect(r.program.forms).toHaveLength(2);
    expect(r.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(r.diagnostics.every((d) => d.kind === "parse-error")).toBe(true);
    const broken = asDefn(r.program, "broken");
    expect(broken.body.k).toBe("error");
    const ok = asDefn(r.program, "ok");
    expect(ok.body).toMatchObject({ k: "app", fn: "+" });
    const okStart = ok.span.start;
    expect(r.diagnostics.every((d) => d.span.end <= okStart)).toBe(true);
  });

  test.each(["effects.lts", "stock.lts", "cycle-a.lts", "cycle-b.lts"])("%s は診断ゼロでパースできる", (name) => {
    const r = parseFixture(name);
    expect(r.diagnostics).toEqual([]);
    expect(r.program.forms.length).toBeGreaterThanOrEqual(1);
  });

  test("effects.lts: defn! でも effect 宣言と do bind がパースできる", () => {
    const r = parseFixture("effects.lts");
    const eff = r.program.forms[0];
    expect(eff).toMatchObject({ k: "effectDef", name: "log" });
    const pureRun = asDefn(r.program, "pure-run");
    expect(pureRun.body.k).toBe("do");
    if (pureRun.body.k === "do") {
      const app = pureRun.body.binds[0].expr;
      expect(app).toMatchObject({ k: "app", fn: "log!", effect: true });
    }
  });

  test("stock.lts: obj パターン（tag リテラル + 変数束縛）", () => {
    const r = parseFixture("stock.lts");
    const show = asDefn(r.program, "show-error");
    const match = show.body as Match;
    expect(match.k).toBe("match");
    const pat = match.arms[0].pattern;
    expect(pat.k).toBe("pobj");
    if (pat.k === "pobj") {
      expect(pat.fields[0]).toMatchObject({ name: "tag" });
      expect(pat.fields[0].pattern).toMatchObject({ k: "plit", litKind: "string", value: "PriceChanged" });
      expect(pat.fields[1].pattern).toMatchObject({ k: "pvar", name: "p" });
    }
  });
});

describe("予約語の不正使用は parse-error (§2.3 予約語)", () => {
  const RESERVED = [
    "defn", "defn!", "fn", "let", "if", "when", "cond", "and", "or", "match", "do", "obj",
    "type", "effect", "prop", "forall", "example", "import", "export",
    "Array", "union", "Result", "Option",
  ];
  for (const w of RESERVED) {
    test(`変数位置の '${w}'`, () => {
      const r = parseSrc(`(defn f () : number ${w})`);
      expect(r.diagnostics.some((d) => d.kind === "parse-error")).toBe(true);
    });
  }
  test("適用位置の特殊フォームの引数不足も parse-error", () => {
    for (const src of ["(if 1 2)", "(let 1)", "(cond)", "(match x)", "(do)", "(and 1)", "(-> x)"]) {
      const r = parseSrc(`(defn f () : number ${src})`);
      expect(r.diagnostics.some((d) => d.kind === "parse-error"), src).toBe(true);
    }
  });
  test("トップレベルでないフォームは parse-error", () => {
    const r = parseSrc("(let [a 1] a)");
    expect(r.diagnostics.some((d) => d.kind === "parse-error")).toBe(true);
  });
});

describe("特殊フォーム (§3.5)", () => {
  test("let の bind ベクタと本体", () => {
    const r = parseSrc("(defn f () : number (let [a 1 b 2] (+ a b)))");
    expect(r.diagnostics).toEqual([]);
    const body = asDefn(r.program, "f").body;
    expect(body.k).toBe("let");
    if (body.k === "let") {
      expect(body.binds.map((b) => b.name)).toEqual(["a", "b"]);
      expect(body.body).toMatchObject({ k: "app", fn: "+" });
    }
  });

  test("cond: 最後の [:else e] が必須。無ければ parse-error + insert fix", () => {
    const missing = parseSrc("(defn f (x : number) : number (cond [true 1] [false 2]))");
    const d = missing.diagnostics.find((d) => d.kind === "parse-error");
    expect(d).toBeDefined();
    expect(d?.fix).toMatchObject({ op: "insert" });
    expect(d?.fix && "template" in d.fix ? d.fix.template : "").toContain(":else");
    const ok = parseSrc("(defn f (x : number) : number (cond [true 1] [:else 2]))");
    expect(ok.diagnostics).toEqual([]);
    const body = asDefn(ok.program, "f").body;
    expect(body.k).toBe("cond");
    if (body.k === "cond") {
      expect(body.arms).toHaveLength(1);
      expect(body.else).toMatchObject({ k: "lit", value: 2 });
    }
  });

  test("[ ... ] は式の位置では ( ... ) に正規化される (§3.2)", () => {
    const r = parseSrc("(defn f () : number [x 1])");
    expect(r.diagnostics).toEqual([]);
    expect(asDefn(r.program, "f").body).toMatchObject({ k: "app", fn: "x" });
  });

  test("'{' は予約のため parse-error (§3.2)", () => {
    const r = parseSrc("(defn f () : number { 1 })");
    expect(r.diagnostics.some((d) => d.kind === "parse-error" && d.message.includes("{"))).toBe(true);
  });

  test("-> パイプと dotted field access", () => {
    const r = parseSrc("(defn f (o : (obj (a : number))) : number (-> o.a g h))");
    expect(r.diagnostics).toEqual([]);
    const body = asDefn(r.program, "f").body;
    expect(body.k).toBe("pipe");
    if (body.k === "pipe") {
      expect(body.exprs).toHaveLength(3);
      expect(body.exprs[0]).toMatchObject({ k: "fieldAccess", parts: ["o", "a"] });
    }
  });

  test("defn! は effect フラグ付きの defn", () => {
    const r = parseSrc("(defn! f () : nil (ok nil))");
    expect(r.diagnostics).toEqual([]);
    expect(asDefn(r.program, "f").effect).toBe(true);
  });

  test("fn 式のパラメータと型", () => {
    const r = parseSrc("(defn f () : number (fn (x : number) (y : number) : number (+ x y)))");
    expect(r.diagnostics).toEqual([]);
    const body = asDefn(r.program, "f").body;
    expect(body.k).toBe("fn");
    if (body.k === "fn") {
      expect(body.params.map((p) => p.name)).toEqual(["x", "y"]);
      expect(body.ret).toMatchObject({ k: "prim", name: "number" });
    }
  });

  test("括弧不足は parse-error（レキサは無罪、パーサの仕事 §9.4）", () => {
    const r = parseSrc("(+ 1 2");
    expect(r.diagnostics.some((d) => d.kind === "parse-error")).toBe(true);
  });
});

describe("型構文 (§3.3)", () => {
  test("(Option T) は (union T nil) に正規化される", () => {
    const r = parseSrc("(type X (Option number))");
    expect(r.diagnostics).toEqual([]);
    const td = r.program.forms[0] as TypeDef;
    expect(td.type).toMatchObject({ k: "union", members: [{ k: "prim", name: "number" }, { k: "prim", name: "nil" }] });
  });

  test("tag リテラルフィールドと fn 型", () => {
    const r = parseSrc('(type E (union (obj (tag "A")) (obj (tag "B") (x : number))))');
    expect(r.diagnostics).toEqual([]);
    const r2 = parseSrc("(effect log : (fn (s : string) : nil))");
    expect(r2.diagnostics).toEqual([]);
    const eff = r2.program.forms[0];
    expect(eff).toMatchObject({ k: "effectDef", type: { k: "fn" } });
  });

  test("import のワイルドカードは禁止 (§3.8)", () => {
    const r = parseSrc('(import "./x.lts" (*))');
    expect(r.diagnostics.some((d) => d.kind === "parse-error")).toBe(true);
  });
});

describe("コメントトリビアの保存 (§2.4)", () => {
  test("フォーム直前のコメントはそのフォームの leading に付く (cart.lts)", () => {
    const r = parseFixture("cart.lts");
    const placeError = r.program.forms.find((f) => f.k === "typeDef" && (f as TypeDef).name === "PlaceError") as TypeDef;
    expect(placeError.leading.some((c) => c.includes("place-order"))).toBe(true);
  });

  test("match アームの leading コメント (cart.lts check-items)", () => {
    const r = parseFixture("cart.lts");
    const checkItems = asDefn(r.program, "check-items");
    const match = (checkItems.body as If).else as Match;
    expect(match.arms[0].leading).toHaveLength(2);
    expect(match.arms[0].leading[0]).toContain("Option CartItem");
  });

  test("ファイル末尾のコメントは program.trailing に付く (money.lts)", () => {
    const r = parseFixture("money.lts");
    expect(r.program.trailing.some((c) => c.includes("prop はP0では受理のみ"))).toBe(true);
  });

  test("コメントのみのソース: forms 空 + trailing", () => {
    const r = parseSrc(";; hello\n");
    expect(r.program.forms).toEqual([]);
    expect(r.program.trailing).toEqual([";; hello"]);
    expect(r.diagnostics).toEqual([]);
  });
});
