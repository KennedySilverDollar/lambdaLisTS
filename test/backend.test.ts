import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { emit, jsName } from "../src/backend/js";
import { RUNTIME_JS } from "../src/backend/runtime";
import type { EmitResult } from "../src/backend/js";
import { desugar } from "../src/core/desugar";
import { normalizeSource, tokenize } from "../src/lexer/lexer";
import { parseProgram } from "../src/parser/parser";
import { checkFile } from "../src/types/check";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const pipeline = (abs: string) => {
  const source = normalizeSource(readFileSync(abs, "utf8"));
  const lexed = tokenize(source, abs);
  const parsed = parseProgram(lexed);
  const ds = desugar(parsed.program);
  return { defs: ds.defs, source, abs, diagnostics: [...lexed.diagnostics, ...parsed.diagnostics, ...ds.diagnostics] };
};

const pipelineSrc = (src: string) => {
  const source = normalizeSource(src);
  const lexed = tokenize(source, "test.lts");
  const parsed = parseProgram(lexed);
  const ds = desugar(parsed.program);
  return { defs: ds.defs, source };
};

const emitFixture = (base: string): EmitResult & { name: string } => {
  const name = `${base}.lts`;
  const p = pipeline(fixturePath(name));
  const checked = checkFile(p.abs);
  const r = emit({
    defs: p.defs,
    source: p.source,
    file: `${base}.js`,
    sourceFile: name,
    runtimeImportPath: "./runtime.js",
    typeNames: new Set(checked.typeAliases.keys()),
  });
  return Object.assign(r, { name });
};

const writeOut = (dir: string, name: string, res: { js: string; map: string }): void => {
  writeFileSync(join(dir, `${name}.js`), res.js);
  writeFileSync(join(dir, `${name}.js.map`), res.map);
  writeFileSync(join(dir, "runtime.js"), RUNTIME_JS);
};

describe("名前変換 (§12.3)", () => {
  test("kebab→snake、末尾?→_q、JS予約語→$接頭辞", () => {
    expect(jsName("add-money")).toBe("add_money");
    expect(jsName("contains?")).toBe("contains_q");
    expect(jsName("any?")).toBe("any_q");
    expect(jsName("class")).toBe("$class");
    expect(jsName("new")).toBe("$new");
    expect(jsName("zero")).toBe("zero");
    expect(jsName("fold-left")).toBe("fold_left");
  });
});

describe("emit: money.lts / cart.lts の生成と実行 (§12, §10.5)", () => {
  test("money.lts → スナップショット + 決定性（2回生成して文字列同一）", () => {
    const r1 = emitFixture("money");
    const r2 = emitFixture("money");
    if ("errors" in r1 || "errors" in r2) throw new Error("emit errors");
    expect(r1.js).toBe(r2.js);
    expect(r1.map).toBe(r2.map);
    expect(r1.js).toContain("export function add_money(");
    expect(r1.js).toContain("export function zero(");
    expect(r1.js).toContain('import { ok, err, structuralEqual } from "./runtime.js";');
    expect(r1.js).toContain("const $stdlib_str_concat");
    expect(r1.js).toContain("const $stdlib_add");
    expect(r1.js).toContain("sourceMappingURL=money.js.map");
    expect(r1.js).toMatchSnapshot();
    expect(JSON.parse(r1.map).version).toBe(3);
    expect(JSON.parse(r1.map).sources).toEqual(["money.lts"]);
  });

  test("money.js を node で実行 → 付録A example と同じ結果", () => {
    const r = emitFixture("money");
    if ("errors" in r) throw new Error("emit errors");
    const dir = mkdtempSync(join(tmpdir(), "lists-money-"));
    writeOut(dir, "money", r);
    const run = spawnSync(process.execPath, ["money.js"], { cwd: dir, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("example 0: ok");
    expect(run.stdout).toContain('"tag":"Ok"');
    expect(run.stdout).toContain('"amount":3');
    expect(run.stdout).toContain('"currency":"JPY"');
  });

  test("cart.lts → cart.js が money.js を import して実行 → 空カートは Err EmptyCart", () => {
    const money = emitFixture("money");
    const cart = emitFixture("cart");
    if ("errors" in money || "errors" in cart) throw new Error("emit errors");
    expect(cart.js).toContain('import { add_money, zero } from "./money.js";');
    const dir = mkdtempSync(join(tmpdir(), "lists-cart-"));
    writeOut(dir, "money", money);
    writeOut(dir, "cart", cart);
    const run = spawnSync(process.execPath, ["cart.js"], { cwd: dir, encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("example 0: ok");
    expect(run.stdout).toContain('"tag":"Err"');
    expect(run.stdout).toContain('"tag":"EmptyCart"');
  });

  test("生成JSの Do は早期リターン形式 (§12.4)", () => {
    const cart = emitFixture("cart");
    if ("errors" in cart) throw new Error("emit errors");
    expect(cart.js).toMatch(/if \(\$r\d+\.tag === "Err"\) return \$r\d+;/);
    expect(cart.js).toMatchSnapshot();
  });
});

describe("defn! モジュールは JS 生成エラー (§7.5)", () => {
  test("effect 宣言 + defn! → emit は errors を返す", () => {
    const p = pipelineSrc("(effect log : (fn (s : string) : nil))\n(defn! f (s : string) : nil (log! s))");
    const r = emit({ defs: p.defs, source: p.source, file: "test.js", sourceFile: "test.lts" });
    expect("errors" in r).toBe(true);
    if ("errors" in r) {
      expect(r.errors.length).toBeGreaterThanOrEqual(1);
      expect(r.errors[0].kind).toBe("unsupported-in-p0");
      expect(r.errors[0].message).toContain("defn!");
    }
  });
});

describe("T8 前段: source map のスタックトレースが .lts 行を指す (§10.4)", () => {
  test("深い再帰でスタックオーバーフロー → --enable-source-maps のトレースに fact.lts:行", () => {
    const r = emitFixture("fact");
    if ("errors" in r) throw new Error("emit errors");
    const dir = mkdtempSync(join(tmpdir(), "lists-t8-"));
    writeOut(dir, "fact", r);
    writeFileSync(join(dir, "run.js"), 'import { fact } from "./fact.js";\nfact(100000);\n');
    const run = spawnSync(process.execPath, ["--enable-source-maps", "run.js"], { cwd: dir, encoding: "utf8" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("Maximum call stack size exceeded");
    expect(run.stderr).toMatch(/fact\.lts:\d+/);
  });
});
