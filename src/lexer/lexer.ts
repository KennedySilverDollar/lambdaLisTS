import type { Diagnostic } from "../diagnostic.js";
import type { Span, Token, TokenType } from "./token.js";

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
  trailingComments: string[];
}

const TWO_CHAR_PUNCTS = new Set(["<=", ">=", "=>", "->"]);
const ONE_CHAR_PUNCTS = new Set([":", "+", "-", "*", "/", "<", ">", "="]);
const SYMBOL_NAME_START = /[a-zA-Z_]/;
const SYMBOL_NAME_CHAR = /[a-zA-Z0-9_\-?]/;
const DIGIT = /[0-9]/;
const HEX_DIGIT = /[0-9a-fA-F]/;
const NUMBER_RE = /-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;

export function normalizeSource(source: string): string {
  let text = source;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, "\n");
}

export function tokenize(source: string, file: string): LexResult {
  const text = normalizeSource(source);

  const lineStarts: number[] = [0];
  for (let k = 0; k < text.length; k++) {
    if (text[k] === "\n") lineStarts.push(k + 1);
  }

  const span = (start: number, end: number): Span => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= start) lo = mid;
      else hi = mid - 1;
    }
    return { file, start, end, line: lo + 1, col: start - lineStarts[lo] + 1 };
  };

  const tokens: Token[] = [];
  const diagnostics: Diagnostic[] = [];
  let pendingComments: string[] = [];
  const n = text.length;
  let i = 0;

  const emit = (type: TokenType, start: number, end: number, value?: unknown): void => {
    tokens.push({
      type,
      text: text.slice(start, end),
      value,
      span: span(start, end),
      leading: pendingComments,
    });
    pendingComments = [];
  };

  const emitError = (start: number, end: number, message: string): void => {
    diagnostics.push({ kind: "parse-error", severity: "error", span: span(start, end), message });
    emit("error", start, end);
  };

  const lexNumber = (start: number): number => {
    NUMBER_RE.lastIndex = start;
    const m = NUMBER_RE.exec(text);
    if (m === null) {
      emitError(start, start + 1, "不正な数値です");
      return start + 1;
    }
    emit("number", start, start + m[0].length, Number(m[0]));
    return start + m[0].length;
  };

  const lexKeyword = (start: number): number => {
    let j = start + 1;
    while (j < n && SYMBOL_NAME_CHAR.test(text[j])) j++;
    emit("keyword", start, j, text.slice(start + 1, j));
    return j;
  };

  const lexString = (start: number): number => {
    let j = start + 1;
    let value = "";
    while (j < n) {
      const ch = text[j];
      if (ch === "\n") {
        emitError(start, j, "文字列リテラルが閉じていません");
        return j;
      }
      if (ch === '"') {
        emit("string", start, j + 1, value);
        return j + 1;
      }
      if (ch === "\\") {
        const esc = j + 1 < n ? text[j + 1] : "";
        if (esc === "" || esc === "\n") {
          emitError(start, j + 1, "文字列リテラルが閉じていません");
          return j + 1;
        }
        if (esc === "u") {
          const hex = text.slice(j + 2, j + 6);
          if (hex.length === 4 && [...hex].every((h) => HEX_DIGIT.test(h))) {
            value += String.fromCharCode(parseInt(hex, 16));
            j += 6;
            continue;
          }
          emitError(start, j + 2, "\\u エスケープには4桁の16進数が必要です");
          return j + 2;
        }
        const simple: Record<string, string> = { '"': '"', "\\": "\\", n: "\n", t: "\t", r: "\r" };
        if (esc in simple) {
          value += simple[esc];
          j += 2;
          continue;
        }
        emitError(start, j + 2, `無効なエスケープシーケンスです: \\${esc}`);
        return j + 2;
      }
      value += ch;
      j++;
    }
    emitError(start, n, "文字列リテラルが閉じていません");
    return n;
  };

  const lexSymbol = (start: number): number => {
    let j = start;
    const readName = (): string => {
      let k = j;
      while (k < n && SYMBOL_NAME_CHAR.test(text[k])) k++;
      const name = text.slice(j, k);
      j = k;
      return name;
    };
    const first = readName();
    const segments: string[] = [first];
    let dotted = false;
    while (j < n && text[j] === "." && j + 1 < n && SYMBOL_NAME_START.test(text[j + 1])) {
      dotted = true;
      j++;
      segments.push(readName());
    }
    if (j < n && text[j] === "!") {
      if (dotted) {
        emitError(start, j + 1, "ドットシンボルの末尾に '!' は使用できません");
        return j + 1;
      }
      j++;
      if (j < n && text[j] === ".") {
        emitError(start, j + 1, "'!' を含むシンボルをドットで連結することはできません");
        return j + 1;
      }
      emit("symbol", start, j);
      return j;
    }
    if (!dotted) {
      if (first === "nil") {
        emit("nil", start, j);
        return j;
      }
      if (first === "true" || first === "false") {
        emit("bool", start, j, first === "true");
        return j;
      }
    }
    emit(dotted ? "dottedSymbol" : "symbol", start, j);
    return j;
  };

  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === ";") {
      let j = i;
      while (j < n && text[j] !== "\n") j++;
      pendingComments.push(text.slice(i, j));
      i = j;
      continue;
    }
    if (c === "(" || c === ")") {
      emit("paren", i, i + 1);
      i++;
      continue;
    }
    if (c === "[" || c === "]") {
      emit("bracket", i, i + 1);
      i++;
      continue;
    }
    if (c === "{" || c === "}") {
      emit("brace", i, i + 1);
      i++;
      continue;
    }
    if (c === '"') {
      i = lexString(i);
      continue;
    }
    if (DIGIT.test(c) || (c === "-" && i + 1 < n && DIGIT.test(text[i + 1]))) {
      i = lexNumber(i);
      continue;
    }
    if (c === ":" && i + 1 < n && SYMBOL_NAME_START.test(text[i + 1])) {
      i = lexKeyword(i);
      continue;
    }
    if (i + 1 < n && TWO_CHAR_PUNCTS.has(text.slice(i, i + 2))) {
      emit("punct", i, i + 2);
      i += 2;
      continue;
    }
    if (ONE_CHAR_PUNCTS.has(c)) {
      emit("punct", i, i + 1);
      i++;
      continue;
    }
    if (SYMBOL_NAME_START.test(c)) {
      i = lexSymbol(i);
      continue;
    }
    emitError(i, i + 1, `不正な文字です: '${c}'`);
    i++;
  }

  return { tokens, diagnostics, trailingComments: pendingComments };
}
