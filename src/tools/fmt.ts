import type { Diagnostic } from "../diagnostic.js";
import { normalizeSource, tokenize } from "../lexer/lexer.js";
import type * as ast from "../parser/ast.js";
import { parseProgram } from "../parser/parser.js";

export function formatSource(src: string, file = "stdin.lts"): { output: string; diagnostics: Diagnostic[] } {
  const parsed = parseProgram(tokenize(normalizeSource(src), file));
  if (parsed.diagnostics.length > 0) return { output: src, diagnostics: parsed.diagnostics };
  return { output: printProgram(parsed.program), diagnostics: [] };
}

function printProgram(p: ast.Program): string {
  const parts: string[] = [];
  for (const f of p.forms) {
    parts.push(printTopForm(f, ""));
  }
  for (const c of p.trailing) parts.push(c);
  return `${parts.join("\n")}\n`;
}

function comments(node: { leading: string[] }, ind: string): string {
  return node.leading.length > 0 ? `${node.leading.map((c) => `${ind}${c}`).join("\n")}\n` : "";
}

function printTopForm(f: ast.TopForm, ind: string): string {
  const c = comments(f, ind);
  switch (f.k) {
    case "import":
      return `${c}${ind}(import ${printStringLit(f.path)} (${f.names.join(" ")}))`;
    case "export":
      return `${c}${ind}(export ${f.names.join(" ")})`;
    case "typeDef":
      return `${c}${ind}(type ${f.name} ${printType(f.type)})`;
    case "effectDef":
      return `${c}${ind}(effect ${f.name} : ${printType(f.type)})`;
    case "defn": {
      const params = f.params.length > 0 ? ` ${f.params.map((p) => printParam(p)).join(" ")}` : " ()";
      const head = `${ind}(defn${f.effect ? "!" : ""} ${f.name}${params} : ${printType(f.ret)}`;
      return `${c}${head}\n${ind}  ${printExpr(f.body, `${ind}  `)})`;
    }
    case "prop": {
      const quant = `[${f.params.map((p) => printParam(p)).join(" ")}]`;
      return `${c}${ind}(prop ${printStringLit(f.name)} (forall ${quant} ${printExpr(f.body, `${ind}  `)}))`;
    }
    case "example":
      return `${c}${ind}(example ${printExpr(f.actual, `${ind}  `)}\n${ind}  => ${printExpr(f.expected, `${ind}  `)})`;
    case "error":
      return `${c}${ind}`;
  }
}

function isBlocky(e: ast.Expr): boolean {
  return e.k === "match" || e.k === "do" || e.k === "cond";
}

function printExpr(e: ast.Expr, ind: string): string {
  const c = comments(e, ind);
  let body: string;
  switch (e.k) {
    case "lit":
      body = e.litKind === "string" ? printStringLit(e.value as string) : e.litKind === "nil" ? "nil" : String(e.value);
      break;
    case "sym":
      body = e.name;
      break;
    case "fieldAccess":
      body = e.parts.join(".");
      break;
    case "app":
      body = printApp(e.fn, e.args, ind);
      break;
    case "let": {
      const binds = e.binds.map((b) => `${b.name} ${printExpr(b.expr, ind)}`);
      body = joinList("let", [`[${binds.join(" ")}]`, printExpr(e.body, ind)], ind);
      break;
    }
    case "if":
      body = joinList("if", [printExpr(e.cond, ind), printExpr(e.then, ind), printExpr(e.else, ind)], ind);
      break;
    case "when":
      body = joinList("when", [printExpr(e.cond, ind), printExpr(e.body, ind)], ind);
      break;
    case "and":
    case "or":
      body = joinList(e.k, [printExpr(e.left, ind), printExpr(e.right, ind)], ind);
      break;
    case "cond": {
      const arms = e.arms.map((a) => `[${printExpr(a.cond, ind)} ${printExpr(a.body, ind)}]`);
      body = `(cond\n${arms.map((a) => `${ind}  ${a}`).join("\n")}\n${ind}  [:else ${printExpr(e.else, ind)}]\n${ind})`;
      break;
    }
    case "match": {
      const arms = e.arms.map(
        (a) => `${comments(a, `${ind}  `)}${ind}  [${printPattern(a.pattern)} ${printExpr(a.body, `${ind}    `)}]`,
      );
      body = `(match ${printExpr(e.scrutinee, ind)}\n${arms.join("\n")}\n${ind})`;
      break;
    }
    case "do": {
      const binds = e.binds.map((b) => `${ind}  [${b.name} ${printExpr(b.expr, `${ind}    `)}]`);
      body = `(do\n${binds.join("\n")}\n${ind}  ${printExpr(e.body, `${ind}  `)}\n${ind})`;
      break;
    }
    case "obj":
      body = joinList("obj", e.fields.map((f) => `(${f.name} ${printExpr(f.expr, ind)})`), ind);
      break;
    case "fn": {
      const params = e.params.length > 0 ? ` ${e.params.map((p) => printParam(p)).join(" ")}` : " ()";
      body = joinList(`fn${params} : ${printType(e.ret)}`, [printExpr(e.body, ind)], ind);
      break;
    }
    case "pipe":
      body = joinList("->", e.exprs.map((x) => printExpr(x, ind)), ind);
      break;
    case "error":
      body = `(${e.message})`;
      break;
  }
  return `${c}${body}`;
}

function joinList(head: string, args: string[], ind: string): string {
  if (args.every((a) => !a.includes("\n"))) return `(${head} ${args.join(" ")})`;
  return `(${head}\n${args.map((a) => `${ind}  ${a}`).join("\n")}\n${ind})`;
}

function printApp(fn: string, args: ast.Expr[], ind: string): string {
  return joinList(fn, args.map((a) => printExpr(a, ind)), ind);
}

function printParam(p: ast.Param): string {
  return `(${p.name} : ${printType(p.type)})`;
}

function printType(t: ast.TypeExpr): string {
  switch (t.k) {
    case "prim":
      return t.name;
    case "alias":
      return t.name;
    case "array":
      return `(Array ${printType(t.element)})`;
    case "union":
      return `(union ${t.members.map(printType).join(" ")})`;
    case "obj":
      return `(obj ${t.fields
        .map((f) => (f.k === "field" ? `(${f.name} : ${printType(f.type)})` : `(${f.name} ${printStringLit(f.value)})`))
        .join(" ")})`;
    case "result":
      return `(Result ${printType(t.ok)} ${printType(t.err)})`;
    case "fn": {
      const params = t.params.length > 0 ? ` ${t.params.map(printParam).join(" ")}` : " ()";
      return `(fn${params} : ${printType(t.ret)})`;
    }
    case "error":
      return "_";
  }
}

function printPattern(p: ast.Pattern): string {
  switch (p.k) {
    case "wildcard":
      return "_";
    case "pvar":
      return p.name;
    case "plit":
      return p.litKind === "string" ? printStringLit(p.value as string) : p.litKind === "nil" ? "nil" : String(p.value);
    case "pobj":
      return `(obj ${p.fields.map((f) => `(${f.name} ${printPattern(f.pattern)})`).join(" ")})`;
    case "parray":
      return `(Array ${p.elements.map(printPattern).join(" ")})`;
    case "por":
      return `(or ${p.patterns.map(printPattern).join(" ")})`;
  }
}

export function printStringLit(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch === "\r") out += "\\r";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}
