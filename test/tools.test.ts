import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { runCli } from "../src/tools/cli";
import { formatSource } from "../src/tools/fmt";
import { Repl } from "../src/tools/repl";
import { normalizeSource, tokenize } from "../src/lexer/lexer";
import { parseProgram } from "../src/parser/parser";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const stripSpans = (x: unknown): unknown => {
  if (Array.isArray(x)) return x.map(stripSpans);
  if (x && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      if (k === "span") continue;
      o[k] = stripSpans(v);
    }
    return o;
  }
  return x;
};

describe("REPL (§10.1 ゴールデン)", () => {
  test("§10.1 の入出力例", () => {
    const repl = new Repl();
    const out1 = repl.handleLine('{"id": 1, "op": "eval", "src": "(defn add (a : number) (b : number) : number (+ a b))"}');
    expect(JSON.parse(out1!)).toEqual({
      id: 1,
      ok: true,
      defined: "add",
      type: "(fn (number number) : number)",
    });
    const out2 = repl.handleLine('{"id": 2, "op": "test"}');
    expect(JSON.parse(out2!)).toEqual({ id: 2, ok: true, results: [] });
    const out3 = repl.handleLine('{"id": 3, "op": "prop", "name": "add-money commutative"}');
    expect(JSON.parse(out3!)).toEqual({
      id: 3,
      ok: false,
      errors: [{ kind: "unsupported-in-p0", message: "prop評価はP1で実装" }],
    });
    const out5 = repl.handleLine('{"id": 5, "op": "type-of", "src": "add"}');
    expect(JSON.parse(out5!)).toEqual({ id: 5, ok: true, type: "(fn (number number) : number)" });
    expect(repl.handleLine('{"id": 6, "op": "quit"}')).toBe(null);
  });

  test("eval で診断がある場合は ok:false + errors", () => {
    const repl = new Repl();
    const out = repl.handleLine('{"id": 1, "op": "eval", "src": "(defn f () : number (ok \\"a\\"))"}');
    const res = JSON.parse(out!);
    expect(res.ok).toBe(false);
    expect(res.errors[0].kind).toBe("type-mismatch");
  });

  test("reload + test: cart.lts の example が pass", () => {
    const repl = new Repl();
    const r1 = repl.handleLine(`{"id": 4, "op": "reload", "file": ${JSON.stringify(fixturePath("cart.lts"))}}`);
    expect(JSON.parse(r1!)).toEqual({ id: 4, ok: true });
    const r2 = repl.handleLine('{"id": 2, "op": "test"}');
    expect(JSON.parse(r2!)).toEqual({ id: 2, ok: true, results: [{ example: "example 0", pass: true }] });
    const r3 = repl.handleLine('{"id": 5, "op": "type-of", "src": "place-order"}');
    expect(JSON.parse(r3!).type).toContain("(Result");
  });
});

describe("fmt (§10.3)", () => {
  test.each(["money.lts", "cart.lts", "stock.lts", "effects.lts", "cycle-a.lts", "fact.lts"])("%s: 冪等 fmt(fmt(x)) === fmt(x)", (name) => {
    const src = readFileSync(fixturePath(name), "utf8");
    const once = formatSource(src, name);
    expect(once.diagnostics).toEqual([]);
    const twice = formatSource(once.output, name);
    expect(twice.diagnostics).toEqual([]);
    expect(twice.output).toBe(once.output);
  });

  test.each(["money.lts", "cart.lts", "stock.lts", "effects.lts"])("%s: パース→fmt→パースで AST 同一（span 除く）", (name) => {
    const src = readFileSync(fixturePath(name), "utf8");
    const once = formatSource(src, name).output;
    const a = parseProgram(tokenize(normalizeSource(src), name)).program;
    const b = parseProgram(tokenize(normalizeSource(once), name)).program;
    expect(stripSpans(b)).toEqual(stripSpans(a));
  });

  test("コメント保存: cart.lts のコメントが正規位置に残る", () => {
    const src = readFileSync(fixturePath("cart.lts"), "utf8");
    const out = formatSource(src, "cart.lts").output;
    expect(out).toContain(";; place-order は戻り値としてエラー型を unify する");
    const idxComment = out.indexOf(";; place-order");
    const idxType = out.indexOf("(type PlaceError");
    expect(idxComment).toBeGreaterThanOrEqual(0);
    expect(idxComment).toBeLessThan(idxType);
    expect(out).toContain(";; (Option CartItem) = (union CartItem nil)");
  });

  test("数値正規化: 1.50 → 1.5、1E5 → 100000", () => {
    const out = formatSource("(defn f () : number 1.50)\n(defn g () : number 1E5)", "t.lts").output;
    expect(out).toContain("(defn f () : number\n  1.5)");
    expect(out).toContain("100000");
  });

  test("文字列エスケープの正規化と defn の改行スタイル", () => {
    const out = formatSource('(defn f () : string "a\\nb\\t")', "t.lts").output;
    expect(out).toBe('(defn f () : string\n  "a\\nb\\t")\n');
    const m = formatSource("(defn f (x : number) : number (match x [0 1] [_ 2]))", "t.lts").output;
    expect(m).toContain("(match x\n    [0 1]\n    [_ 2]");
  });

  test("パースエラー時は元ソースをそのまま返す", () => {
    const src = "(defn broken (x : number) : number\n  (if (< x 0) (- 0 x) x\n";
    const r = formatSource(src, "broken.lts");
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.output).toBe(src);
  });
});

describe("CLI (§10.5)", () => {
  test("compile: money.lts + cart.lts を --out に出力し runtime.js も出力、stdout は []、exit 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lists-cli-"));
    const code = await runCli(
      ["compile", fixturePath("money.lts"), fixturePath("cart.lts"), "--out", dir],
      process.cwd(),
    );
    expect(code).toBe(0);
    expect(existsSync(join(dir, "money.js"))).toBe(true);
    expect(existsSync(join(dir, "money.js.map"))).toBe(true);
    expect(existsSync(join(dir, "cart.js"))).toBe(true);
    expect(existsSync(join(dir, "runtime.js"))).toBe(true);
    const run = spawnSync(process.execPath, ["cart.js"], { cwd: dir, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("example 0: ok");
  });

  test("compile: broken.lts は診断 JSON を stdout に出して exit 1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lists-cli-bad-"));
    const logs: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      logs.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await runCli(["compile", fixturePath("broken.lts"), "--out", dir], process.cwd());
      expect(code).toBe(1);
    } finally {
      process.stdout.write = origWrite;
    }
    const diags = JSON.parse(logs.join(""));
    expect(Array.isArray(diags)).toBe(true);
    expect(diags.some((d: { kind: string }) => d.kind === "parse-error")).toBe(true);
  });

  test("fmt: in-place で冪等", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lists-fmt-"));
    const target = join(dir, "money.lts");
    copyFileSync(fixturePath("money.lts"), target);
    const code = await runCli(["fmt", target], process.cwd());
    expect(code).toBe(0);
    const once = readFileSync(target, "utf8");
    const code2 = await runCli(["fmt", target], process.cwd());
    expect(code2).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(once);
    expect(once).not.toBe(readFileSync(fixturePath("money.lts"), "utf8"));
  });
});
