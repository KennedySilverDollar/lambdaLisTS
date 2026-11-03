import { describe, expect, test } from "vitest";
import { tokenize } from "../src/lexer/lexer";
import type { Token } from "../src/lexer/token";

const lex = (src: string) => tokenize(src, "test.lts");
const types = (src: string) => lex(src).tokens.map((t) => t.type);
const texts = (src: string) => lex(src).tokens.map((t) => t.text);
const pairs = (src: string) => lex(src).tokens.map((t) => [t.type, t.text] as const);

describe("基本トークン (§2.2)", () => {
  test("(+ 1 2) → paren, punct(+), number(1), number(2), paren", () => {
    const r = lex("(+ 1 2)");
    expect(r.diagnostics).toEqual([]);
    expect(pairs("(+ 1 2)")).toEqual([
      ["paren", "("],
      ["punct", "+"],
      ["number", "1"],
      ["number", "2"],
      ["paren", ")"],
    ]);
    expect(r.tokens[2].value).toBe(1);
    expect(r.tokens[3].value).toBe(2);
  });

  test("(a : Money) → paren, symbol, punct(:), symbol, paren", () => {
    expect(pairs("(a : Money)")).toEqual([
      ["paren", "("],
      ["symbol", "a"],
      ["punct", ":"],
      ["symbol", "Money"],
      ["paren", ")"],
    ]);
  });

  test("括弧・ブラケット・ブレース", () => {
    expect(types("()[]{}")).toEqual(["paren", "paren", "bracket", "bracket", "brace", "brace"]);
  });

  test("ws はストリームに残さない", () => {
    const r = lex("  \t\n\r  ");
    expect(r.tokens).toEqual([]);
    expect(r.diagnostics).toEqual([]);
    expect(r.trailingComments).toEqual([]);
  });
});

describe("punct と最長一致 (§2.2)", () => {
  test("全 punct トークン", () => {
    expect(texts("<= >= => -> : + - * / < > =")).toEqual([
      "<=", ">=", "=>", "->", ":", "+", "-", "*", "/", "<", ">", "=",
    ]);
    expect(lex("<= >= => -> : + - * / < > =").tokens.every((t) => t.type === "punct")).toBe(true);
  });

  test("最長一致: <= >= => -> は2文字トークン優先", () => {
    expect(texts("<=")).toEqual(["<="]);
    expect(texts(">=")).toEqual([">="]);
    expect(texts("=>")).toEqual(["=>"]);
    expect(texts("->")).toEqual(["->"]);
    expect(texts("<=>")).toEqual(["<=", ">"]);
    expect(texts("-> 5")).toEqual(["->", "5"]);
  });

  test("- は直後が数字なら number、それ以外は punct", () => {
    expect(lex("-5").tokens[0]).toMatchObject({ type: "number", text: "-5", value: -5 });
    expect(texts("- 5")).toEqual(["-", "5"]);
    expect(lex("- 5").tokens[0].type).toBe("punct");
    expect(texts("- x")).toEqual(["-", "x"]);
  });

  test("+ は number の一部にならない", () => {
    expect(texts("+5")).toEqual(["+", "5"]);
    expect(lex("+5").tokens[0].type).toBe("punct");
  });
});

describe("アトム (§2.3)", () => {
  test("symbol: add-money / contains? / db! / _", () => {
    expect(lex("add-money").tokens[0]).toMatchObject({ type: "symbol", text: "add-money" });
    expect(lex("contains?").tokens[0]).toMatchObject({ type: "symbol", text: "contains?" });
    expect(lex("db!").tokens[0]).toMatchObject({ type: "symbol", text: "db!" });
    expect(lex("_").tokens[0]).toMatchObject({ type: "symbol", text: "_" });
  });

  test("number: -5 / 1.50 / 1E5 / 指数", () => {
    expect(lex("-5").tokens[0]).toMatchObject({ type: "number", value: -5 });
    expect(lex("1.50").tokens[0]).toMatchObject({ type: "number", text: "1.50", value: 1.5 });
    expect(lex("1E5").tokens[0]).toMatchObject({ type: "number", text: "1E5", value: 100000 });
    expect(lex("42").tokens[0].value).toBe(42);
    expect(lex("2e-3").tokens[0].value).toBe(0.002);
    expect(lex("1.5e+2").tokens[0].value).toBe(150);
    expect(lex("-0.5").tokens[0]).toMatchObject({ type: "number", value: -0.5 });
  });

  test("dotted-symbol: x.y.z は1トークン", () => {
    expect(lex("x.y.z").tokens).toHaveLength(1);
    expect(lex("x.y.z").tokens[0]).toMatchObject({ type: "dottedSymbol", text: "x.y.z" });
    expect(lex("o.a").tokens[0].type).toBe("dottedSymbol");
    expect(lex("i.price.amount").tokens[0]).toMatchObject({ type: "dottedSymbol", text: "i.price.amount" });
    expect(lex("a.b").tokens).toHaveLength(1);
  });

  test("keyword: :else", () => {
    expect(lex(":else").tokens[0]).toMatchObject({ type: "keyword", text: ":else", value: "else" });
    expect(lex(": else").tokens[0]).toMatchObject({ type: "punct", text: ":" });
  });

  test("string とエスケープ", () => {
    const r = lex('"a\\n"');
    expect(r.diagnostics).toEqual([]);
    expect(r.tokens[0]).toMatchObject({ type: "string", text: '"a\\n"', value: "a\n" });
    expect(lex('"say \\"hi\\""').tokens[0].value).toBe('say "hi"');
    expect(lex('"tab\\t"').tokens[0].value).toBe("tab\t");
    expect(lex('"cr\\r"').tokens[0].value).toBe("cr\r");
    expect(lex('"bs\\\\"').tokens[0].value).toBe("bs\\");
    expect(lex('"\\u0041"').tokens[0].value).toBe("A");
    expect(lex('"plain"').tokens[0].value).toBe("plain");
  });

  test("nil / bool は専用トークン、他の予約語は symbol", () => {
    expect(lex("nil").tokens[0]).toMatchObject({ type: "nil", text: "nil" });
    expect(lex("true").tokens[0]).toMatchObject({ type: "bool", value: true });
    expect(lex("false").tokens[0]).toMatchObject({ type: "bool", value: false });
    expect(lex("nilx").tokens[0]).toMatchObject({ type: "symbol", text: "nilx" });
    expect(lex("defn").tokens[0].type).toBe("symbol");
    expect(lex("Array").tokens[0].type).toBe("symbol");
  });
});

describe("コメントの保持 (§2.4)", () => {
  test("コメントは次のトークンの leading に付く", () => {
    const r = lex(";; c\n(defn f)");
    expect(r.tokens[0]).toMatchObject({ type: "paren", text: "(", leading: [";; c"] });
    expect(r.tokens[1]).toMatchObject({ type: "symbol", text: "defn", leading: [] });
  });

  test("フォーム先頭のコメントは直後のシンボルに付く", () => {
    const r = lex("(;; c\ndefn f)");
    expect(r.tokens[0].leading).toEqual([]);
    expect(r.tokens[1]).toMatchObject({ type: "symbol", text: "defn", leading: [";; c"] });
  });

  test("複数コメントは順序どおりに並ぶ", () => {
    expect(lex("; a\n; b\nx").tokens[0].leading).toEqual(["; a", "; b"]);
  });

  test("ファイル末尾のコメントは trailingComments として別途返る", () => {
    const r = lex("(+ 1 2) ;; end\n");
    expect(r.trailingComments).toEqual([";; end"]);
    expect(r.tokens.every((t: Token) => t.leading.length === 0)).toBe(true);
  });
});

describe("エラートークン (§2.2/§2.3, §9.4)", () => {
  test("括弧不足はレキサではエラーにしない（パーサの仕事）", () => {
    const r = lex("(+ 1 2");
    expect(r.diagnostics).toEqual([]);
    expect(texts("(+ 1 2")).toEqual(["(", "+", "1", "2"]);
  });

  test("不正な文字は error トークン + parse-error 診断で続行", () => {
    const r = lex("@ + 1");
    expect(r.tokens.map((t) => t.type)).toEqual(["error", "punct", "number"]);
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ kind: "parse-error", severity: "error" });
    expect(r.diagnostics[0].span).toMatchObject({ file: "test.lts", start: 0, end: 1, line: 1, col: 1 });
  });

  test("閉じていない文字列", () => {
    const r = lex('"abc');
    expect(r.tokens[0].type).toBe("error");
    expect(r.diagnostics[0]).toMatchObject({ kind: "parse-error", severity: "error" });
    const r2 = lex('"abc\ndef"');
    expect(r2.tokens[0].type).toBe("error");
    expect(r2.diagnostics[0].kind).toBe("parse-error");
  });

  test("無効なエスケープ", () => {
    const r = lex('"a\\x"');
    expect(r.tokens[0].type).toBe("error");
    expect(r.diagnostics[0].kind).toBe("parse-error");
    const r2 = lex('"\\u12"');
    expect(r2.diagnostics[0].kind).toBe("parse-error");
  });

  test("ドットの中間・末尾に '!' を含むシンボルは不可", () => {
    const r1 = lex("o.f!");
    expect(r1.tokens[0].type).toBe("error");
    expect(r1.diagnostics[0].kind).toBe("parse-error");
    const r2 = lex("a!.b");
    expect(r2.tokens[0].type).toBe("error");
    expect(r2.diagnostics[0].kind).toBe("parse-error");
  });

  test("単独のドット・単独の ! は error", () => {
    expect(lex(".").tokens[0].type).toBe("error");
    expect(lex("!").tokens[0].type).toBe("error");
    expect(lex("a.").tokens[1].type).toBe("error");
  });
});

describe("span (§2.5)", () => {
  test("全トークンに span が付き、行・列は1始まり", () => {
    const r = lex("(+ 1\n  2)");
    expect(r.tokens[0].span).toEqual({ file: "test.lts", start: 0, end: 1, line: 1, col: 1 });
    const two = r.tokens[3];
    expect(two.text).toBe("2");
    expect(two.span).toEqual({ file: "test.lts", start: 7, end: 8, line: 2, col: 3 });
    expect(r.tokens.every((t) => typeof t.span.start === "number" && t.span.line >= 1 && t.span.col >= 1)).toBe(true);
  });
});

describe("文字コード (§2.1)", () => {
  test("BOM は許容して無視する", () => {
    const r = lex("\uFEFF(+ 1)");
    expect(r.diagnostics).toEqual([]);
    expect(r.tokens[0]).toMatchObject({ type: "paren", text: "(" });
    expect(r.tokens[0].span.start).toBe(0);
  });

  test("CRLF は LF に正規化される", () => {
    const r = lex("(+ 1\r\n  2)");
    expect(r.diagnostics).toEqual([]);
    expect(r.tokens[3].span).toMatchObject({ line: 2, col: 3 });
  });
});
