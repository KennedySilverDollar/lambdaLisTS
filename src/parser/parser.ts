import type { Diagnostic } from "../diagnostic.js";
import { tokenize } from "../lexer/lexer.js";
import type { LexResult } from "../lexer/lexer.js";
import type { Span, Token } from "../lexer/token.js";
import type * as ast from "./ast.js";

export interface ParseResult {
  program: ast.Program;
  diagnostics: Diagnostic[];
}

type AtomRaw = { kind: "atom"; token: Token };
type ListRaw = { kind: "list"; open: Token; items: Raw[]; close: Token | null; span: Span; leading: string[] };
type ErrorRaw = { kind: "error"; token: Token };
type Raw = AtomRaw | ListRaw | ErrorRaw;

const asAtom = (r: Raw): r is AtomRaw => r.kind === "atom";
const asList = (r: Raw): r is ListRaw => r.kind === "list";

const TOP_HEADS = new Set(["defn", "defn!", "type", "effect", "import", "export", "prop", "example"]);
const SPECIAL_HEADS = new Set(["let", "if", "when", "cond", "and", "or", "match", "do", "obj", "fn"]);
const RESERVED = new Set([
  "defn", "defn!", "fn", "let", "if", "when", "cond", "and", "or", "match", "do", "obj",
  "type", "effect", "prop", "forall", "example", "import", "export",
  "Array", "union", "Result", "Option",
]);
const PRIMS = new Set(["number", "string", "bool"]);
const OPERATORS = new Set(["+", "-", "*", "/", "<", ">", "<=", ">=", "="]);

export function parseProgram(input: Token[] | LexResult): ParseResult {
  const lex: LexResult = Array.isArray(input)
    ? { tokens: input, diagnostics: [], trailingComments: [] }
    : input;
  const parser = new Parser(lex.tokens);
  const raws = parser.readAll();
  const counters = { prop: 0, example: 0 };
  const forms: ast.TopForm[] = raws.map((r) => parser.buildTopForm(r, counters));
  const first = lex.tokens[0];
  const last = lex.tokens[lex.tokens.length - 1];
  const span: Span = first
    ? { file: first.span.file, start: first.span.start, end: last.span.end, line: first.span.line, col: first.span.col }
    : { file: "", start: 0, end: 0, line: 1, col: 1 };
  const program: ast.Program = { k: "program", forms, trailing: lex.trailingComments, span, leading: [] };
  return { program, diagnostics: [...lex.diagnostics, ...parser.diagnostics] };
}

export function parseExpr(src: string, file: string): { expr: ast.Expr | null; diagnostics: Diagnostic[] } {
  const lex = tokenize(src, file);
  const parser = new Parser(lex.tokens);
  const raws = parser.readAll();
  const expr = raws.length > 0 ? parser.buildExpr(raws[0], "(expr)") : null;
  return { expr, diagnostics: [...lex.diagnostics, ...parser.diagnostics] };
}

class Parser {
  private pos = 0;
  private depth = 0;
  readonly diagnostics: Diagnostic[] = [];

  constructor(private tokens: Token[]) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private advance(): void {
    this.pos++;
  }

  private error(span: Span, message: string, data?: object, fix?: Diagnostic["fix"]): void {
    this.diagnostics.push({ kind: "parse-error", severity: "error", span, message, data, fix });
  }

  private rawSpanOf(r: Raw): Span {
    return r.kind === "list" ? r.span : r.token.span;
  }

  private joinSpan(a: Span, b: Span): Span {
    return { file: a.file, start: a.start, end: b.end, line: a.line, col: a.col };
  }

  readAll(): Raw[] {
    const raws: Raw[] = [];
    for (;;) {
      if (!this.peek()) break;
      const r = this.readRaw();
      if (r) raws.push(r);
    }
    return raws;
  }

  private isTopHead(t: Token | undefined): boolean {
    return t !== undefined && t.type === "symbol" && TOP_HEADS.has(t.text);
  }

  private readRaw(): Raw | null {
    const t = this.peek();
    if (!t) return null;
    if (t.type === "error") {
      this.advance();
      return { kind: "error", token: t };
    }
    if (t.type === "brace") {
      if (t.text === "{") {
        this.error(t.span, "'{' は予約されており P0 では使用できません (§3.2)");
        let d = 0;
        for (;;) {
          const u = this.peek();
          if (!u) break;
          this.advance();
          if (u.type === "brace" && u.text === "{") d++;
          if (u.type === "brace" && u.text === "}") {
            if (d === 0) break;
            d--;
          }
        }
      } else {
        this.error(t.span, "対応する '{' がありません");
        this.advance();
      }
      return { kind: "error", token: t };
    }
    if (t.type === "paren" || t.type === "bracket") {
      if (t.text === "(" || t.text === "[") return this.readList(t);
      this.error(t.span, `対応する開き括弧がありません: '${t.text}'`);
      this.advance();
      return { kind: "error", token: t };
    }
    this.advance();
    return { kind: "atom", token: t };
  }

  private readList(open: Token): ListRaw {
    this.advance();
    this.depth++;
    const items: Raw[] = [];
    let close: Token | null = null;
    for (;;) {
      const t = this.peek();
      if (!t) {
        this.error(open.span, `括弧が閉じていません: '${open.text}' が閉じられていません`);
        break;
      }
      if ((t.type === "paren" || t.type === "bracket") && (t.text === ")" || t.text === "]")) {
        close = t;
        this.advance();
        break;
      }
      if (t.type === "paren" && t.text === "(" && this.isTopHead(this.peek(1))) {
        this.error(open.span, "括弧が閉じていません: 次のトップレベルフォームの直前で強制クローズしました (§9.4)");
        break;
      }
      const r = this.readRaw();
      if (r) items.push(r);
    }
    this.depth--;
    const end = close ? close.span.end : items.length > 0 ? this.rawSpanOf(items[items.length - 1]).end : open.span.end;
    const span: Span = { file: open.span.file, start: open.span.start, end, line: open.span.line, col: open.span.col };
    return { kind: "list", open, items, close, span, leading: open.leading };
  }

  buildTopForm(raw: Raw, counters: { prop: number; example: number }): ast.TopForm {
    const errNode = (message: string, span: Span, leading: string[]): ast.ErrorNode => ({ k: "error", message, span, leading });
    if (raw.kind === "error") {
      return errNode("不正なトークンです", raw.token.span, raw.token.leading);
    }
    if (raw.kind === "atom") {
      this.error(raw.token.span, "トップレベルには (...) のフォームが必要です");
      return errNode("フォームではありません", raw.token.span, raw.token.leading);
    }
    if (raw.items.length === 0) {
      this.error(raw.span, "空のフォームです");
      return errNode("空のフォームです", raw.span, raw.leading);
    }
    const head = raw.items[0];
    if (!asAtom(head) || head.token.type !== "symbol") {
      this.error(raw.span, "トップレベルフォームの先頭はシンボルでなければなりません");
      return errNode("先頭がシンボルではありません", raw.span, raw.leading);
    }
    const name = head.token.text;
    const args = raw.items.slice(1);
    switch (name) {
      case "import":
        return this.buildImport(raw, args);
      case "export":
        return this.buildExport(raw, args);
      case "type":
        return this.buildTypeDef(raw, args);
      case "effect":
        return this.buildEffectDef(raw, args);
      case "defn":
      case "defn!":
        return this.buildDefn(raw, head.token, args, `(defn ${this.peekName(args)})`);
      case "prop": {
        const path = `(prop ${counters.prop++})`;
        return this.buildProp(raw, args, path);
      }
      case "example": {
        const path = `(example ${counters.example++})`;
        return this.buildExample(raw, args, path);
      }
      default:
        this.error(head.token.span, `不明なトップレベルフォームです: '${name}'`);
        return errNode(`不明なフォーム: ${name}`, raw.span, raw.leading);
    }
  }

  private peekName(args: Raw[]): string {
    const a = args[0];
    return a && asAtom(a) && a.token.type === "symbol" ? a.token.text : "?";
  }

  private buildImport(raw: ListRaw, args: Raw[]): ast.Import {
    let path = "";
    const pathRaw = args[0];
    if (pathRaw && asAtom(pathRaw) && pathRaw.token.type === "string") {
      path = (pathRaw.token.value ?? "") as string;
    } else {
      this.error(raw.span, 'import は (import "path" (name*)) の形です');
    }
    const names: string[] = [];
    const namesRaw = args[1];
    if (namesRaw && asList(namesRaw)) {
      for (const item of namesRaw.items) {
        if (asAtom(item) && item.token.type === "symbol") {
          names.push(item.token.text);
        } else if (asAtom(item) && item.token.type === "punct" && item.token.text === "*") {
          this.error(item.token.span, "import のワイルドカード '*' は禁止されています (§3.8)");
        } else {
          this.error(this.rawSpanOf(item), "import の名前はシンボルでなければなりません");
        }
      }
    } else {
      this.error(raw.span, 'import は (import "path" (name*)) の形です');
    }
    if (args.length !== 2) this.error(raw.span, "import の引数が不正です");
    return { k: "import", path, names, span: raw.span, leading: raw.leading };
  }

  private buildExport(raw: ListRaw, args: Raw[]): ast.Export {
    const names: string[] = [];
    for (const item of args) {
      if (asAtom(item) && item.token.type === "symbol") {
        if (RESERVED.has(item.token.text)) this.error(item.token.span, `予約語 '${item.token.text}' は export できません`);
        names.push(item.token.text);
      } else {
        this.error(this.rawSpanOf(item), "export の引数はシンボルでなければなりません");
      }
    }
    return { k: "export", names, span: raw.span, leading: raw.leading };
  }

  private buildTypeDef(raw: ListRaw, args: Raw[]): ast.TypeDef {
    const name = this.peekName(args);
    if (args.length !== 2 || !asAtom(args[0]) || args[0].token.type !== "symbol") {
      this.error(raw.span, "type は (type Name TypeExpr) の形です");
    } else if (RESERVED.has(name)) {
      this.error(args[0].token.span, `予約語 '${name}' は型名に使えません`);
    }
    const type = args[1] ? this.buildType(args[1], "(type).type") : this.typeError("型がありません", raw.span, raw.leading);
    return { k: "typeDef", name, type, span: raw.span, leading: raw.leading };
  }

  private buildEffectDef(raw: ListRaw, args: Raw[]): ast.EffectDef {
    const nameRaw = args[0];
    const name = nameRaw && asAtom(nameRaw) && nameRaw.token.type === "symbol" ? nameRaw.token.text : "";
    if (args.length !== 3 || !name) {
      this.error(raw.span, "effect は (effect name : TypeExpr) の形です");
    }
    const colon = args[1];
    if (!(colon && asAtom(colon) && colon.token.type === "punct" && colon.token.text === ":")) {
      this.error(raw.span, "effect には ':' が必要です");
    }
    const type = args[2] ? this.buildType(args[2], "(effect).type") : this.typeError("型がありません", raw.span, raw.leading);
    return { k: "effectDef", name, type, span: raw.span, leading: raw.leading };
  }

  private buildDefn(raw: ListRaw, head: Token, args: Raw[], path: string): ast.Defn {
    const effect = head.text === "defn!";
    let i = 0;
    let name = "";
    if (args[0] && asAtom(args[0]) && args[0].token.type === "symbol") {
      name = args[0].token.text;
      if (RESERVED.has(name)) this.error(args[0].token.span, `予約語 '${name}' は定義名に使えません`);
      i = 1;
    } else {
      this.error(raw.span, "defn には名前が必要です");
    }
    const params: ast.Param[] = [];
    for (;;) {
      const a = args[i];
      if (!a || !asList(a)) break;
      if (a.items.length === 0) {
        i++;
        continue;
      }
      params.push(this.buildParam(a, `${path}.params.${params.length}`));
      i++;
    }
    const colon = args[i];
    if (!(colon && asAtom(colon) && colon.token.type === "punct" && colon.token.text === ":")) {
      this.error(raw.span, "defn には ':' と戻り値の型が必要です", { expected: "':' Type body", actual: "missing" });
      return { k: "defn", effect, name, params, ret: this.typeError(":' と型がありません", raw.span, raw.leading), body: this.exprError("本体がありません", raw.span, raw.leading), span: raw.span, leading: raw.leading };
    }
    i++;
    if (i >= args.length) {
      this.error(raw.span, "defn には戻り値の型が必要です");
      return { k: "defn", effect, name, params, ret: this.typeError("型がありません", raw.span, raw.leading), body: this.exprError("本体がありません", raw.span, raw.leading), span: raw.span, leading: raw.leading };
    }
    const ret = this.buildType(args[i], `${path}.ret`);
    i++;
    if (i >= args.length) {
      this.error(raw.span, "defn には本体が必要です");
      return { k: "defn", effect, name, params, ret, body: this.exprError("本体がありません", raw.span, raw.leading), span: raw.span, leading: raw.leading };
    }
    const body = this.buildExpr(args[i], `${path}.body`);
    i++;
    if (i < args.length) this.error(raw.span, "defn の引数が多すぎます");
    return { k: "defn", effect, name, params, ret, body, span: raw.span, leading: raw.leading };
  }

  private buildProp(raw: ListRaw, args: Raw[], path: string): ast.Prop {
    let name = "";
    if (args[0] && asAtom(args[0]) && args[0].token.type === "string") {
      name = (args[0].token.value ?? "") as string;
    } else {
      this.error(raw.span, 'prop は (prop "name" (forall [param*] expr)) の形です');
    }
    const fa = args[1];
    let params: ast.Param[] = [];
    let body: ast.Expr = this.exprError("本体がありません", raw.span, raw.leading);
    if (fa && asList(fa) && fa.items.length >= 1 && asAtom(fa.items[0]) && fa.items[0].token.type === "symbol" && fa.items[0].token.text === "forall") {
      const faArgs = fa.items.slice(1);
      const quant = faArgs[0];
      if (quant && asList(quant)) {
        for (const item of quant.items) {
          if (asList(item) && item.items.length === 0) continue;
          params.push(this.buildParam(item, `${path}.params.${params.length}`));
        }
      } else {
        this.error(raw.span, "forall には [param*] の量化子ベクタが必要です");
      }
      if (faArgs[1]) body = this.buildExpr(faArgs[1], `${path}.body`);
      else this.error(raw.span, "forall には本体が必要です");
    } else {
      this.error(raw.span, "prop の第2引数は (forall [param*] expr) でなければなりません");
    }
    if (args.length !== 2) this.error(raw.span, "prop の引数が不正です");
    return { k: "prop", name, params, body, span: raw.span, leading: raw.leading };
  }

  private buildExample(raw: ListRaw, args: Raw[], path: string): ast.Example {
    const arrow = args[1];
    if (args.length !== 3 || !(arrow && asAtom(arrow) && arrow.token.type === "punct" && arrow.token.text === "=>")) {
      this.error(raw.span, "example は (example expr => expr) の形です", { expected: "expr '=>' expr", actual: String(args.length) });
    }
    const actual = args[0] ? this.buildExpr(args[0], `${path}.args.0`) : this.exprError("左辺がありません", raw.span, raw.leading);
    const expected = args[2] ? this.buildExpr(args[2], `${path}.args.2`) : this.exprError("右辺がありません", raw.span, raw.leading);
    return { k: "example", actual, expected, span: raw.span, leading: raw.leading };
  }

  private typeError(message: string, span: Span, leading: string[]): ast.TypeExpr {
    return { k: "error", message, span, leading };
  }

  private exprError(message: string, span: Span, leading: string[]): ast.ErrorNode {
    return { k: "error", message, span, leading };
  }

  private buildParam(raw: Raw, path: string): ast.Param {
    if (
      asList(raw) &&
      raw.items.length === 3 &&
      asAtom(raw.items[0]) &&
      raw.items[0].token.type === "symbol" &&
      asAtom(raw.items[1]) &&
      raw.items[1].token.type === "punct" &&
      raw.items[1].token.text === ":"
    ) {
      const nameTok = raw.items[0].token;
      if (RESERVED.has(nameTok.text)) this.error(nameTok.span, `予約語 '${nameTok.text}' は仮引数名に使えません`);
      return { k: "param", name: nameTok.text, type: this.buildType(raw.items[2], `${path}.type`), span: raw.span, leading: raw.leading };
    }
    this.error(this.rawSpanOf(raw), "param は (name : Type) の形です");
    return { k: "param", name: "", type: this.typeError("不正な param です", this.rawSpanOf(raw), []), span: this.rawSpanOf(raw), leading: [] };
  }

  private buildType(raw: Raw, path: string): ast.TypeExpr {
    if (raw.kind === "error") {
      return { k: "error", message: "不正なトークンです", span: raw.token.span, leading: raw.token.leading };
    }
    if (raw.kind === "atom") {
      const t = raw.token;
      if (t.type === "nil") return { k: "prim", name: "nil", span: t.span, leading: t.leading };
      if (t.type === "symbol") {
        if (PRIMS.has(t.text)) return { k: "prim", name: t.text as "number" | "string" | "bool", span: t.span, leading: t.leading };
        if (RESERVED.has(t.text)) {
          this.error(t.span, `予約語 '${t.text}' は型名として使えません`);
          return { k: "error", message: `予約語 '${t.text}' は型名として使えません`, span: t.span, leading: t.leading };
        }
        return { k: "alias", name: t.text, span: t.span, leading: t.leading };
      }
      this.error(t.span, `トークン '${t.text}' は型になれません`);
      return { k: "error", message: `トークン '${t.text}' は型になれません`, span: t.span, leading: t.leading };
    }
    if (raw.close === null) {
      return { k: "error", message: "括弧が閉じていません", span: raw.span, leading: raw.leading };
    }
    if (raw.items.length === 0) {
      this.error(raw.span, "空の型フォームです");
      return { k: "error", message: "空の型フォームです", span: raw.span, leading: raw.leading };
    }
    const head = raw.items[0];
    if (!asAtom(head) || head.token.type !== "symbol") {
      this.error(raw.span, "型フォームの先頭はシンボルでなければなりません");
      return { k: "error", message: "型フォームの先頭はシンボルではありません", span: raw.span, leading: raw.leading };
    }
    const name = head.token.text;
    const args = raw.items.slice(1);
    switch (name) {
      case "Array": {
        if (args.length !== 1) this.error(raw.span, "Array は (Array T) の形です", { expected: 1, actual: args.length });
        return { k: "array", element: args[0] ? this.buildType(args[0], `${path}.element`) : this.typeError("要素型がありません", raw.span, raw.leading), span: raw.span, leading: raw.leading };
      }
      case "union": {
        if (args.length < 1) this.error(raw.span, "union には1つ以上の型が必要です");
        return { k: "union", members: args.map((a, i) => this.buildType(a, `${path}.members.${i}`)), span: raw.span, leading: raw.leading };
      }
      case "obj": {
        const fields: ast.Field[] = [];
        for (let i = 0; i < args.length; i++) {
          const f = args[i];
          if (asList(f) && f.items.length === 3 && asAtom(f.items[0]) && f.items[0].token.type === "symbol" && asAtom(f.items[1]) && f.items[1].token.type === "punct" && f.items[1].token.text === ":") {
            fields.push({ k: "field", name: f.items[0].token.text, type: this.buildType(f.items[2], `${path}.fields.${i}.type`), span: f.span, leading: f.leading });
          } else if (asList(f) && f.items.length === 2 && asAtom(f.items[0]) && f.items[0].token.type === "symbol" && asAtom(f.items[1]) && f.items[1].token.type === "string") {
            fields.push({ k: "tag", name: f.items[0].token.text, value: (f.items[1].token.value ?? "") as string, span: f.span, leading: f.leading });
          } else {
            this.error(this.rawSpanOf(f), "obj のフィールドは (name : Type) または (name \"tag\") の形です");
          }
        }
        return { k: "obj", fields, span: raw.span, leading: raw.leading };
      }
      case "Result": {
        if (args.length !== 2) this.error(raw.span, "Result は (Result T E) の形です", { expected: 2, actual: args.length });
        const ok = args[0] ? this.buildType(args[0], `${path}.ok`) : this.typeError("Ok 型がありません", raw.span, raw.leading);
        const err = args[1] ? this.buildType(args[1], `${path}.err`) : this.typeError("Err 型がありません", raw.span, raw.leading);
        return { k: "result", ok, err, span: raw.span, leading: raw.leading };
      }
      case "Option": {
        if (args.length !== 1) this.error(raw.span, "Option は (Option T) の形です", { expected: 1, actual: args.length });
        const t = args[0] ? this.buildType(args[0], `${path}.element`) : this.typeError("要素型がありません", raw.span, raw.leading);
        return { k: "union", members: [t, { k: "prim", name: "nil", span: raw.span, leading: raw.leading }], span: raw.span, leading: raw.leading };
      }
      case "fn": {
        const params: ast.Param[] = [];
        let i = 0;
        for (;;) {
          const a = args[i];
          if (!a || !asList(a)) break;
          if (a.items.length === 0) {
            i++;
            continue;
          }
          params.push(this.buildParam(a, `${path}.params.${params.length}`));
          i++;
        }
        const colon = args[i];
        if (!(colon && asAtom(colon) && colon.token.type === "punct" && colon.token.text === ":")) {
          this.error(raw.span, "fn 型には ':' と戻り値の型が必要です");
          return { k: "fn", params, ret: this.typeError("戻り値の型がありません", raw.span, raw.leading), span: raw.span, leading: raw.leading };
        }
        i++;
        if (i >= args.length) {
          this.error(raw.span, "fn 型には戻り値の型が必要です");
          return { k: "fn", params, ret: this.typeError("戻り値の型がありません", raw.span, raw.leading), span: raw.span, leading: raw.leading };
        }
        const ret = this.buildType(args[i], `${path}.ret`);
        return { k: "fn", params, ret, span: raw.span, leading: raw.leading };
      }
      default:
        if (RESERVED.has(name)) {
          this.error(head.token.span, `予約語 '${name}' は型コンストラクタとして不正です`);
        } else {
          this.error(head.token.span, `不明な型コンストラクタです: '${name}'`);
        }
        return { k: "error", message: `不明な型コンストラクタ: ${name}`, span: raw.span, leading: raw.leading };
    }
  }

  buildExpr(raw: Raw, path: string): ast.Expr {
    if (raw.kind === "error") {
      return this.exprError("不正なトークンです", raw.token.span, raw.token.leading);
    }
    if (raw.kind === "atom") return this.buildAtom(raw.token);
    if (raw.close === null) {
      return this.exprError("括弧が閉じていません", raw.span, raw.leading);
    }
    if (raw.items.length === 0) {
      this.error(raw.span, "空のフォームです");
      return this.exprError("空のフォームです", raw.span, raw.leading);
    }
    const head = raw.items[0];
    const args = raw.items.slice(1);
    if (asAtom(head) && head.token.type === "punct" && head.token.text === "->") {
      if (args.length < 2) {
        this.error(raw.span, "'->' には2つ以上の式が必要です", { expected: "2+", actual: args.length });
        return this.exprError("-> の引数が不足しています", raw.span, raw.leading);
      }
      return { k: "pipe", exprs: args.map((a, i) => this.buildExpr(a, `${path}.args.${i}`)), span: raw.span, leading: raw.leading };
    }
    if (asAtom(head) && head.token.type === "punct" && OPERATORS.has(head.token.text)) {
      return {
        k: "app",
        fn: head.token.text,
        effect: false,
        args: args.map((a, i) => this.buildExpr(a, `${path}.args.${i}`)),
        span: raw.span,
        leading: raw.leading,
      };
    }
    if (!asAtom(head) || head.token.type !== "symbol") {
      this.error(raw.span, "フォームの先頭はシンボルでなければなりません");
      return this.exprError("先頭がシンボルではありません", raw.span, raw.leading);
    }
    const name = head.token.text;
    if (SPECIAL_HEADS.has(name)) return this.buildSpecial(name, raw, args, path);
    if (RESERVED.has(name)) {
      this.error(head.token.span, `予約語 '${name}' は式として使用できません`);
      return this.exprError(`予約語 '${name}' は使えません`, raw.span, raw.leading);
    }
    return {
      k: "app",
      fn: name,
      effect: name.endsWith("!"),
      args: args.map((a, i) => this.buildExpr(a, `${path}.args.${i}`)),
      span: raw.span,
      leading: raw.leading,
    };
  }

  private buildAtom(t: Token): ast.Expr {
    switch (t.type) {
      case "number":
        return { k: "lit", litKind: "number", value: (t.value ?? 0) as number, span: t.span, leading: t.leading };
      case "string":
        return { k: "lit", litKind: "string", value: (t.value ?? "") as string, span: t.span, leading: t.leading };
      case "bool":
        return { k: "lit", litKind: "bool", value: (t.value ?? false) as boolean, span: t.span, leading: t.leading };
      case "nil":
        return { k: "lit", litKind: "nil", value: null, span: t.span, leading: t.leading };
      case "dottedSymbol":
        return { k: "fieldAccess", parts: t.text.split("."), span: t.span, leading: t.leading };
      case "symbol":
        if (RESERVED.has(t.text)) {
          this.error(t.span, `予約語 '${t.text}' は式として使用できません`);
          return this.exprError(`予約語 '${t.text}' は使えません`, t.span, t.leading);
        }
        return { k: "sym", name: t.text, effect: t.text.endsWith("!"), span: t.span, leading: t.leading };
      default:
        this.error(t.span, `トークン '${t.text}' は式になれません`);
        return this.exprError(`トークン '${t.text}' は式になれません`, t.span, t.leading);
    }
  }

  private buildSpecial(name: string, raw: ListRaw, args: Raw[], path: string): ast.Expr {
    const err = (message: string): ast.ErrorNode => this.exprError(message, raw.span, raw.leading);
    switch (name) {
      case "let": {
        if (args.length !== 2 || !asList(args[0])) {
          this.error(raw.span, "let は (let [bind*] body) の形です", { expected: "[bind*] body", actual: String(args.length) });
          return err("let の構文が不正です");
        }
        const vec = args[0];
        if (vec.items.length % 2 !== 0) this.error(vec.span, "let の bind は [name expr] のペアでなければなりません");
        const binds: ast.Bind[] = [];
        for (let i = 0; i + 1 < vec.items.length; i += 2) {
          const n = vec.items[i];
          if (asAtom(n) && n.token.type === "symbol") {
            if (RESERVED.has(n.token.text)) this.error(n.token.span, `予約語 '${n.token.text}' は束縛名に使えません`);
            const expr = this.buildExpr(vec.items[i + 1], `${path}.binds.${binds.length}`);
            binds.push({ k: "bind", name: n.token.text, expr, span: this.joinSpan(n.token.span, this.exprSpan(expr)), leading: n.token.leading });
          } else {
            this.error(this.rawSpanOf(n), "let の bind 名はシンボルでなければなりません");
          }
        }
        return { k: "let", binds, body: this.buildExpr(args[1], `${path}.body`), span: raw.span, leading: raw.leading };
      }
      case "if": {
        if (args.length !== 3) {
          this.error(raw.span, "if は (if cond then else) の形です", { expected: 3, actual: args.length });
          return err("if の引数が不正です");
        }
        return {
          k: "if",
          cond: this.buildExpr(args[0], `${path}.cond`),
          then: this.buildExpr(args[1], `${path}.then`),
          else: this.buildExpr(args[2], `${path}.else`),
          span: raw.span,
          leading: raw.leading,
        };
      }
      case "when": {
        if (args.length !== 2) {
          this.error(raw.span, "when は (when cond body) の形です", { expected: 2, actual: args.length });
          return err("when の引数が不正です");
        }
        return { k: "when", cond: this.buildExpr(args[0], `${path}.cond`), body: this.buildExpr(args[1], `${path}.body`), span: raw.span, leading: raw.leading };
      }
      case "and":
      case "or": {
        if (args.length !== 2) {
          this.error(raw.span, `${name} は (${name} a b) の形です`, { expected: 2, actual: args.length });
          return err(`${name} の引数が不正です`);
        }
        const left = this.buildExpr(args[0], `${path}.args.0`);
        const right = this.buildExpr(args[1], `${path}.args.1`);
        return name === "and"
          ? { k: "and", left, right, span: raw.span, leading: raw.leading }
          : { k: "or", left, right, span: raw.span, leading: raw.leading };
      }
      case "cond": {
        if (args.length === 0) {
          this.error(raw.span, "cond にはアームが必要です");
          return err("cond にアームがありません");
        }
        const arms: ast.CondArm[] = [];
        let elseExpr: ast.Expr | null = null;
        for (let i = 0; i < args.length; i++) {
          const armRaw = args[i];
          if (!asList(armRaw) || armRaw.items.length !== 2) {
            this.error(this.rawSpanOf(armRaw), "cond のアームは [cond expr] の形です");
            continue;
          }
          const c = armRaw.items[0];
          const b = armRaw.items[1];
          if (i === args.length - 1 && asAtom(c) && c.token.type === "keyword" && c.token.text === ":else") {
            elseExpr = this.buildExpr(b, `${path}.arms.${i}`);
          } else {
            arms.push({
              k: "condArm",
              cond: this.buildExpr(c, `${path}.arms.${i}`),
              body: this.buildExpr(b, `${path}.arms.${i}`),
              span: armRaw.span,
              leading: armRaw.leading,
            });
          }
        }
        if (elseExpr === null) {
          this.error(raw.span, "cond の最後のアームは [:else expr] でなければなりません（網羅性のため §3.5）", undefined, { op: "insert", path: `${path}.arms`, template: "[:else nil]" });
          elseExpr = this.exprError("[:else ...] がありません", raw.span, raw.leading);
        }
        return { k: "cond", arms, else: elseExpr, span: raw.span, leading: raw.leading };
      }
      case "match": {
        if (args.length < 2) {
          this.error(raw.span, "match は (match scrutinee arm+) の形です", { expected: "scrutinee + arm", actual: args.length });
          return err("match の引数が不正です");
        }
        const scrutinee = this.buildExpr(args[0], `${path}.scrutinee`);
        const arms: ast.MatchArm[] = [];
        for (let i = 1; i < args.length; i++) {
          const a = args[i];
          if (!asList(a) || a.items.length !== 2) {
            this.error(this.rawSpanOf(a), "match のアームは [pattern expr] の形です");
            continue;
          }
          arms.push({
            k: "matchArm",
            pattern: this.buildPattern(a.items[0], `${path}.arms.${i - 1}`),
            body: this.buildExpr(a.items[1], `${path}.arms.${i - 1}`),
            span: a.span,
            leading: a.leading,
          });
        }
        return { k: "match", scrutinee, arms, span: raw.span, leading: raw.leading };
      }
      case "do": {
        if (args.length === 0) {
          this.error(raw.span, "do には本体が必要です");
          return err("do に本体がありません");
        }
        const binds: ast.DoBind[] = [];
        for (let i = 0; i < args.length - 1; i++) {
          const b = args[i];
          if (!asList(b) || b.items.length !== 2 || !asAtom(b.items[0]) || b.items[0].token.type !== "symbol") {
            this.error(this.rawSpanOf(b), "do の bind は [name expr] の形です（'_' も可）");
            continue;
          }
          const nameTok = b.items[0].token;
          if (RESERVED.has(nameTok.text)) this.error(nameTok.span, `予約語 '${nameTok.text}' は束縛名に使えません`);
          binds.push({ k: "doBind", name: nameTok.text, expr: this.buildExpr(b.items[1], `${path}.binds.${i}`), span: b.span, leading: b.leading });
        }
        const body = this.buildExpr(args[args.length - 1], `${path}.body`);
        return { k: "do", binds, body, span: raw.span, leading: raw.leading };
      }
      case "obj": {
        const fields: ast.ObjField[] = [];
        for (let i = 0; i < args.length; i++) {
          const f = args[i];
          if (!asList(f) || f.items.length !== 2 || !asAtom(f.items[0]) || f.items[0].token.type !== "symbol") {
            this.error(this.rawSpanOf(f), "obj のフィールドは (name expr) の形です");
            continue;
          }
          fields.push({ k: "objField", name: f.items[0].token.text, expr: this.buildExpr(f.items[1], `${path}.fields.${i}`), span: f.span, leading: f.leading });
        }
        return { k: "obj", fields, span: raw.span, leading: raw.leading };
      }
      case "fn": {
        const params: ast.Param[] = [];
        let i = 0;
        for (;;) {
          const a = args[i];
          if (!a || !asList(a)) break;
          if (a.items.length === 0) {
            i++;
            continue;
          }
          params.push(this.buildParam(a, `${path}.params.${params.length}`));
          i++;
        }
        const colon = args[i];
        if (!(colon && asAtom(colon) && colon.token.type === "punct" && colon.token.text === ":")) {
          this.error(raw.span, "fn には ':' と戻り値の型・本体が必要です");
          return err("fn の構文が不正です");
        }
        i++;
        if (i >= args.length) {
          this.error(raw.span, "fn には戻り値の型が必要です");
          return err("fn に戻り値の型がありません");
        }
        const ret = this.buildType(args[i], `${path}.ret`);
        i++;
        if (i >= args.length) {
          this.error(raw.span, "fn には本体が必要です");
          return err("fn に本体がありません");
        }
        const body = this.buildExpr(args[i], `${path}.body`);
        return { k: "fn", params, ret, body, span: raw.span, leading: raw.leading };
      }
      default:
        return err(`未対応の特殊フォーム: ${name}`);
    }
  }

  private exprSpan(e: ast.Expr): Span {
    return e.span;
  }

  private buildPattern(raw: Raw, path: string): ast.Pattern {
    const wildcard = (span: Span, leading: string[]): ast.Pattern => ({ k: "wildcard", span, leading });
    if (raw.kind === "error") return wildcard(raw.token.span, raw.token.leading);
    if (raw.kind === "atom") {
      const t = raw.token;
      if (t.type === "symbol") {
        if (t.text === "_") return wildcard(t.span, t.leading);
        if (RESERVED.has(t.text)) {
          this.error(t.span, `予約語 '${t.text}' はパターンに使えません`);
          return wildcard(t.span, t.leading);
        }
        return { k: "pvar", name: t.text, span: t.span, leading: t.leading };
      }
      if (t.type === "number") return { k: "plit", litKind: "number", value: (t.value ?? 0) as number, span: t.span, leading: t.leading };
      if (t.type === "string") return { k: "plit", litKind: "string", value: (t.value ?? "") as string, span: t.span, leading: t.leading };
      if (t.type === "bool") return { k: "plit", litKind: "bool", value: (t.value ?? false) as boolean, span: t.span, leading: t.leading };
      if (t.type === "nil") return { k: "plit", litKind: "nil", value: null, span: t.span, leading: t.leading };
      this.error(t.span, `トークン '${t.text}' はパターンになれません`);
      return wildcard(t.span, t.leading);
    }
    if (raw.items.length === 0) {
      this.error(raw.span, "空のパターンです");
      return wildcard(raw.span, raw.leading);
    }
    const head = raw.items[0];
    if (!asAtom(head) || head.token.type !== "symbol") {
      this.error(raw.span, "パターンの先頭はシンボルでなければなりません");
      return wildcard(raw.span, raw.leading);
    }
    const name = head.token.text;
    const args = raw.items.slice(1);
    if (name === "obj") {
      const fields: { name: string; pattern: ast.Pattern; span: Span; leading: string[] }[] = [];
      for (let i = 0; i < args.length; i++) {
        const f = args[i];
        if (!asList(f) || f.items.length !== 2 || !asAtom(f.items[0]) || f.items[0].token.type !== "symbol") {
          this.error(this.rawSpanOf(f), "obj パターンのフィールドは (name pattern) の形です");
          continue;
        }
        fields.push({ name: f.items[0].token.text, pattern: this.buildPattern(f.items[1], `${path}.fields.${i}`), span: f.span, leading: f.leading });
      }
      return { k: "pobj", fields, span: raw.span, leading: raw.leading };
    }
    if (name === "Array") {
      return { k: "parray", elements: args.map((a, i) => this.buildPattern(a, `${path}.${i}`)), span: raw.span, leading: raw.leading };
    }
    if (name === "or") {
      if (args.length < 1) this.error(raw.span, "or パターンには1つ以上のパターンが必要です");
      return { k: "por", patterns: args.map((a, i) => this.buildPattern(a, `${path}.${i}`)), span: raw.span, leading: raw.leading };
    }
    this.error(head.token.span, `不明なパターンです: '${name}'`);
    return wildcard(raw.span, raw.leading);
  }
}
