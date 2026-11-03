import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { desugar } from "../src/core/desugar";
import type { Core, CoreTopForm } from "../src/core/desugar";
import type { Core as CoreNode } from "../src/core/ir";
import { astPath, topFormPath } from "../src/diagnostic";
import { tokenize } from "../src/lexer/lexer";
import { parseProgram } from "../src/parser/parser";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const parseSrc = (src: string) => parseProgram(tokenize(src, "test.lts")).program;
const desugarSrc = (src: string) => desugar(parseSrc(src));
const desugarFixture = (name: string) => desugar(parseProgram(tokenize(fixture(name), name)).program);

const strip = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(strip);
  if (x instanceof Map) return [...x.entries()].map(([k, v]) => [k, strip(v)]);
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      if (k === "span" || k === "leading") continue;
      o[k] = strip(v);
    }
    return o;
  }
  return x;
};

const bodyOf = (src: string): CoreNode => {
  const defs = desugarSrc(src).defs;
  const d = defs[0] as CoreTopForm;
  if (d.k !== "defn") throw new Error(`先頭が defn ではありません: ${d.k}`);
  return d.body;
};

const lit = (value: unknown) => ({ k: "Lit", value });
const v = (name: string) => ({ k: "Var", name });

describe("§4 脱糖表: 各パターン", () => {
  test("let 複数束縛 → 単一 Let のネスト", () => {
    const body = strip(bodyOf("(defn f () : number (let [a 1 b 2] (+ a b)))"));
    expect(body).toEqual({
      k: "Let",
      name: "a",
      rhs: lit(1),
      body: {
        k: "Let",
        name: "b",
        rhs: lit(2),
        body: { k: "App", fn: v("+"), args: [v("a"), v("b")] },
      },
    });
  });

  test("when → If(c, e, Lit(nil))", () => {
    const body = strip(bodyOf("(defn f (x : number) : number (when (< x 0) (- 0 x)))"));
    expect(body).toEqual({
      k: "If",
      cond: { k: "App", fn: v("<"), args: [v("x"), lit(0)] },
      then: { k: "App", fn: v("-"), args: [lit(0), v("x")] },
      else: lit(null),
    });
  });

  test("cond → If のネスト（最後は :else）", () => {
    const body = strip(bodyOf("(defn f (x : number) : number (cond [(< x 0) -1] [true 1] [:else 0]))"));
    expect(body).toEqual({
      k: "If",
      cond: { k: "App", fn: v("<"), args: [v("x"), lit(0)] },
      then: lit(-1),
      else: {
        k: "If",
        cond: lit(true),
        then: lit(1),
        else: lit(0),
      },
    });
  });

  test("and → If(a, b, Lit(false))", () => {
    const body = strip(bodyOf("(defn f (a : bool) (b : bool) : bool (and a b))"));
    expect(body).toEqual({ k: "If", cond: v("a"), then: v("b"), else: lit(false) });
  });

  test("or → Let($t, a, If($t, Lit(true), b))（$t は新鮮）", () => {
    const body = strip(bodyOf("(defn f (a : bool) (b : bool) : bool (or a b))"));
    expect(body).toEqual({
      k: "Let",
      name: "$t",
      rhs: v("a"),
      body: { k: "If", cond: v("$t"), then: lit(true), else: v("b") },
    });
    const nested = strip(bodyOf("(defn f (a : bool) (b : bool) (c : bool) : bool (or (or a b) c))"));
    expect(nested).toMatchObject({ k: "Let", name: "$t" });
    expect(JSON.stringify(nested)).toContain("$t1");
  });

  test("-> パイプ: (-> x f g) → App(g, [App(f, [x])])", () => {
    const body = strip(bodyOf("(defn f (x : number) : number (-> x g h))"));
    expect(body).toEqual({
      k: "App",
      fn: v("h"),
      args: [{ k: "App", fn: v("g"), args: [v("x")] }],
    });
    const single = strip(bodyOf("(defn f (x : number) : number (-> x g))"));
    expect(single).toEqual({ k: "App", fn: v("g"), args: [v("x")] });
  });

  test("obj 構築 → Obj([ [\"a\", e1], ... ])", () => {
    const body = strip(bodyOf('(defn f () : (obj (amount : number)) (obj (amount 0)))'));
    expect(body).toEqual({ k: "Obj", fields: [["amount", lit(0)]] });
  });

  test("dotted a.b.c → Field(Field(Var a, \"b\"), \"c\")", () => {
    const body = strip(bodyOf("(defn f (i : (obj (price : (obj (amount : number))))) : number i.price.amount)"));
    expect(body).toEqual({
      k: "Field",
      obj: { k: "Field", obj: v("i"), name: "price" },
      name: "amount",
    });
  });

  test("型の脱糖: (Option T) → (union T nil)、tag → literal", () => {
    const r = desugarSrc("(type X (Option number))");
    const d = r.defs[0] as Extract<CoreTopForm, { k: "type" }>;
    expect(strip(d.type)).toEqual({ k: "union", members: [{ k: "number" }, { k: "nil" }] });
    const r2 = desugarSrc('(type E (union (obj (tag "EmptyCart")) (obj (tag "NegativeQty") (id : string))))');
    const e = r2.defs[0] as Extract<CoreTopForm, { k: "type" }>;
    expect(strip(e.type)).toEqual({
      k: "union",
      members: [
        { k: "obj", fields: [["tag", { k: "literal", value: "EmptyCart" }]] },
        { k: "obj", fields: [["tag", { k: "literal", value: "NegativeQty" }], ["id", { k: "string" }]] },
      ],
    });
  });

  test("do: [name expr] → Do.binds、'_' は \"_\" のまま", () => {
    const body = strip(bodyOf("(defn f () : number (do [_ (g 1)] [t (h 2)] (+ t 1)))"));
    expect(body).toEqual({
      k: "Do",
      binds: [
        { name: "_", expr: { k: "App", fn: v("g"), args: [lit(1)] } },
        { name: "t", expr: { k: "App", fn: v("h"), args: [lit(2)] } },
      ],
      body: { k: "App", fn: v("+"), args: [v("t"), lit(1)] },
    });
  });

  test("fn → Lam(pure: true)、defn! → pure: false", () => {
    const body = strip(bodyOf("(defn f () : (fn (number) : number) (fn (x : number) : number x))"));
    expect(body).toEqual({
      k: "Lam",
      params: [{ name: "x", type: { k: "number" } }],
      ret: { k: "number" },
      body: v("x"),
      pure: true,
    });
    const d = desugarSrc("(defn! f () : nil (ok nil))").defs[0] as Extract<CoreTopForm, { k: "defn" }>;
    expect(d.pure).toBe(false);
    expect(strip(d.body)).toEqual({ k: "App", fn: v("ok"), args: [lit(null)] });
  });

  test("effect 呼び出し (log! x) → EffectCall", () => {
    const body = strip(bodyOf("(defn f (x : number) : nil (log! (str x)))"));
    expect(body).toEqual({
      k: "EffectCall",
      effect: "log",
      args: [{ k: "App", fn: v("str"), args: [v("x")] }],
    });
  });

  test("match → Match（パターンも Core Pattern へ）", () => {
    const body = strip(bodyOf('(defn f (e : (union (obj (tag "A")) (obj (tag "B") (x : number)))) : number (match e [(obj (tag "A")) 0] [(obj (tag "B") (x p)) p]))'));
    expect(body).toEqual({
      k: "Match",
      scrutinee: v("e"),
      arms: [
        { pattern: { k: "obj", fields: [["tag", { k: "lit", value: "A" }]] }, body: lit(0) },
        { pattern: { k: "obj", fields: [["tag", { k: "lit", value: "B" }], ["x", { k: "var", name: "p" }]] }, body: v("p") },
      ],
    });
  });
});

describe("付録A: IR ゴールデンスナップショット", () => {
  test("money.lts の全 defs", () => {
    const r = desugarFixture("money.lts");
    expect(r.diagnostics).toEqual([]);
    expect(r.defs.map((d) => d.k)).toEqual(["type", "export", "defn", "defn", "example", "prop"]);
    expect(r.defs).toMatchSnapshot();
  });

  test("cart.lts の全 defs", () => {
    const r = desugarFixture("cart.lts");
    expect(r.diagnostics).toEqual([]);
    expect(r.defs.map((d) => d.k)).toEqual([
      "import", "type", "type", "type", "export", "defn", "defn", "defn", "example",
    ]);
    expect(r.defs).toMatchSnapshot();
  });

  test("broken.lts: parse-error が desugar 診断に伝播する", () => {
    const r = desugarFixture("broken.lts");
    expect(r.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(r.diagnostics.every((d) => d.kind === "parse-error")).toBe(true);
    const broken = r.defs.find((d) => d.k === "defn" && d.name === "broken") as Extract<CoreTopForm, { k: "defn" }>;
    expect(broken.body.k).toBe("Error");
    const ok = r.defs.find((d) => d.k === "defn" && d.name === "ok") as Extract<CoreTopForm, { k: "defn" }>;
    expect(ok.body.k).toBe("App");
  });
});

describe("決定性と AST パス (§10.2)", () => {
  test("同一 AST を2回脱糖すると deepEqual", () => {
    const program = parseProgram(tokenize(fixture("cart.lts"), "cart.lts")).program;
    expect(desugar(program)).toEqual(desugar(program));
    const program2 = parseProgram(tokenize(fixture("money.lts"), "money.lts")).program;
    expect(desugar(program2)).toEqual(desugar(program2));
  });

  test("topFormPath / astPath: (defn add-money).body.2.then 形式", () => {
    const program = parseSrc("(defn add-money (a : number) : number (+ a 1))");
    const base = topFormPath(program.forms[0], 0);
    expect(base).toBe("(defn add-money)");
    expect(astPath(base, "body", 2, "then")).toBe("(defn add-money).body.2.then");
    expect(astPath(base)).toBe("(defn add-money)");
  });

  test("defs に AST パスが付く", () => {
    const r = desugarFixture("money.lts");
    const add = r.defs.find((d) => d.k === "defn" && d.name === "add-money");
    expect(add).toMatchObject({ path: "(defn add-money)" });
  });
});
