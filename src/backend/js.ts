import type { CoreTopForm } from "../core/desugar.js";
import type { Core, Pattern, Value } from "../core/ir.js";
import type { Diagnostic } from "../diagnostic.js";
import { stdlibSchemes } from "../types/stdlib.js";
import { createEmitter } from "./sourcemap.js";

const JS_RESERVED = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import",
  "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public",
  "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "undefined", "var",
  "void", "while", "with", "yield",
]);

const RUNTIME_EXPORTS = ["ok", "err", "structuralEqual"] as const;

const STDLIB_ALIAS: Record<string, string> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "<": "lt",
  ">": "gt",
  "<=": "le",
  ">=": "ge",
  "=": "eq",
};

export function stdlibJsName(name: string): string {
  return `$stdlib_${STDLIB_ALIAS[name] ?? jsName(name)}`;
}

export function jsName(name: string): string {
  let n = name.replace(/-/g, "_");
  if (n.endsWith("?")) n = `${n.slice(0, -1)}_q`;
  if (JS_RESERVED.has(n)) n = `$${n}`;
  return n;
}

export function litJs(value: Value): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "NaN";
    if (!Number.isFinite(value)) return value > 0 ? "Infinity" : "-Infinity";
    return String(value);
  }
  return String(value);
}

export interface EmitInput {
  defs: CoreTopForm[];
  source: string;
  file: string;
  sourceFile: string;
  runtimeImportPath?: string;
  typeNames?: Set<string>;
}

export type EmitResult = { js: string; map: string } | { errors: Diagnostic[] };

export function emit(input: EmitInput): EmitResult {
  const errors: Diagnostic[] = [];
  for (const d of input.defs) {
    if (d.k === "error") {
      errors.push({ kind: "parse-error", severity: "error", span: d.span, message: d.message, data: { path: d.path } });
    }
    if (d.k === "defn" && !d.pure) {
      errors.push({
        kind: "unsupported-in-p0",
        severity: "error",
        span: d.span,
        message: `defn! '${d.name}' は P0 の JS 生成ではエラーです（P1 で完全実装 §7.5）`,
        data: { path: d.path },
      });
    }
  }
  if (errors.length > 0) return { errors };

  const gen = new Gen(input.defs, input.typeNames ?? new Set());
  const emitter = createEmitter(input.source);
  const forms = [...input.defs].sort((a, b) => a.span.start - b.span.start);
  let cursor = 0;
  for (const d of forms) {
    if (d.span.start > cursor) emitter.remove(cursor, d.span.start);
    const js = gen.formJs(d);
    if (js === "") emitter.remove(d.span.start, d.span.end);
    else emitter.overwrite(d.span.start, d.span.end, `${js}\n`);
    cursor = d.span.end;
  }
  if (cursor < input.source.length) emitter.remove(cursor, input.source.length);
  emitter.prepend(gen.header());
  const js = `${emitter.toString()}\n//# sourceMappingURL=${input.file}.map\n`;
  const map = emitter.map(input.file, input.sourceFile);
  return { js, map };
}

class Gen {
  private userNames = new Set<string>();
  private exportNames = new Set<string>();
  private stdlibUsed = new Set<string>();
  private freshCounter = 0;
  private exampleIndex = 0;

  constructor(private defs: CoreTopForm[], private typeNames: Set<string>) {
    for (const d of defs) {
      if (d.k === "defn") this.userNames.add(d.name);
      if (d.k === "export") for (const n of d.names) this.exportNames.add(n);
    }
  }

  private fresh(): number {
    return ++this.freshCounter;
  }

  runtimeRef(name: (typeof RUNTIME_EXPORTS)[number]): string {
    return this.userNames.has(name) ? jsName(name) : name;
  }

  private varRef(name: string): string {
    if (this.userNames.has(name)) return jsName(name);
    if ((RUNTIME_EXPORTS as readonly string[]).includes(name)) return this.runtimeRef(name as (typeof RUNTIME_EXPORTS)[number]);
    if (stdlibSchemes.has(name)) {
      this.stdlibUsed.add(name);
      return stdlibJsName(name);
    }
    return jsName(name);
  }

  header(): string {
    const runtimeImport = "./runtime.js";
    let out = "";
    const imports = RUNTIME_EXPORTS.filter((n) => !this.userNames.has(n));
    if (imports.length > 0) out += `import { ${imports.join(", ")} } from ${JSON.stringify(runtimeImport)};\n`;
    for (const name of [...this.stdlibUsed].sort()) {
      out += `const ${stdlibJsName(name)} = ${this.stdlibImpl(name)};\n`;
    }
    if (out !== "") out += "\n";
    return out;
  }

  private stdlibImpl(name: string): string {
    const ok = this.runtimeRef("ok");
    const se = this.runtimeRef("structuralEqual");
    switch (name) {
      case "+": return "(a, b) => a + b";
      case "-": return "(a, b) => a - b";
      case "*": return "(a, b) => a * b";
      case "/": return "(a, b) => a / b";
      case "<": return "(a, b) => a < b";
      case ">": return "(a, b) => a > b";
      case "<=": return "(a, b) => a <= b";
      case ">=": return "(a, b) => a >= b";
      case "=": return `(a, b) => ${se}(a, b)`;
      case "mod": return "(a, b) => a % b";
      case "abs": return "(a) => Math.abs(a)";
      case "min": return "(a, b) => Math.min(a, b)";
      case "max": return "(a, b) => Math.max(a, b)";
      case "not": return "(a) => !a";
      case "str": return '(a) => (a === null ? "nil" : typeof a === "string" ? a : String(a))';
      case "str-concat": return '(...a) => a.join("")';
      case "str-slice": return "(s, i, j) => s.slice(i, j)";
      case "len": return "(s) => s.length";
      case "contains?": return "(s, t) => s.includes(t)";
      case "split": return "(s, t) => s.split(t)";
      case "array": return "(...a) => a";
      case "nth": return `(arr, i) => (i >= 0 && i < arr.length ? ${ok}(arr[i]) : null)`;
      case "count": return "(arr) => arr.length";
      case "slice": return "(arr, i, j) => arr.slice(i, j)";
      case "push": return "(arr, x) => [...arr, x]";
      case "concat": return "(arr, b) => [...arr, ...b]";
      case "map": return "(arr, f) => arr.map((x) => f(x))";
      case "filter": return "(arr, f) => arr.filter((x) => f(x))";
      case "fold-left": return "(arr, init, f) => arr.reduce((acc, x) => f(acc, x), init)";
      case "find": return `(arr, f) => { for (const x of arr) if (f(x)) return ${ok}(x); return null; }`;
      case "any?": return "(arr, f) => arr.some((x) => f(x))";
      case "all?": return "(arr, f) => arr.every((x) => f(x))";
      default: return "(() => { throw new Error('unsupported stdlib: " + name + "'); })";
    }
  }

  formJs(d: CoreTopForm): string {
    switch (d.k) {
      case "defn": {
        const exported = this.exportNames.has(d.name) ? "export " : "";
        const params = d.params.map((p) => jsName(p.name)).join(", ");
        return `${exported}function ${jsName(d.name)}(${params}) {\n${this.stmt(d.body, "  ")}\n}`;
      }
      case "import": {
        const valueNames = d.names.filter((n) => !this.typeNames.has(n));
        if (valueNames.length === 0) return "";
        const path = d.path.replace(/\.lts$/, ".js");
        return `import { ${valueNames.map((n) => jsName(n)).join(", ")} } from ${JSON.stringify(path)};`;
      }
      case "example": {
        const i = this.exampleIndex++;
        const se = this.runtimeRef("structuralEqual");
        return `{\n  const actual = ${this.expr(d.actual, "  ")};\n  const expected = ${this.expr(d.expected, "  ")};\n  if (!${se}(actual, expected)) throw new Error("example ${i} failed: " + JSON.stringify(actual));\n  console.log("example ${i}: ok " + JSON.stringify(actual));\n}`;
      }
      case "prop":
      case "type":
      case "effect":
      case "export":
      case "error":
        return "";
    }
  }

  stmt(e: Core, ind: string): string {
    switch (e.k) {
      case "Do":
        return this.doStmt(e, ind);
      case "If":
        return `${ind}if (${this.expr(e.cond, ind)}) {\n${this.stmt(e.then, `${ind}  `)}\n${ind}} else {\n${this.stmt(e.else, `${ind}  `)}\n${ind}}`;
      case "Let":
        return `${ind}const ${jsName(e.name)} = ${this.expr(e.rhs, ind)};\n${this.stmt(e.body, ind)}`;
      case "Match":
        return this.matchTail(e, ind);
      default:
        return `${ind}return ${this.expr(e, ind)};`;
    }
  }

  private doStmt(e: Extract<Core, { k: "Do" }>, ind: string): string {
    const lines: string[] = [];
    for (const b of e.binds) {
      const r = `$r${this.fresh()}`;
      lines.push(`${ind}const ${r} = ${this.expr(b.expr, ind)};`);
      lines.push(`${ind}if (${r}.tag === "Err") return ${r};`);
      if (b.name !== "_") lines.push(`${ind}const ${jsName(b.name)} = ${r}.value;`);
    }
    lines.push(this.stmt(e.body, ind));
    return lines.join("\n");
  }

  private matchTail(e: Extract<Core, { k: "Match" }>, ind: string, boundScrutinee?: string): string {
    const s = boundScrutinee ?? `$s${this.fresh()}`;
    let out = boundScrutinee === undefined ? `${ind}const ${s} = ${this.expr(e.scrutinee, ind)};\n` : "";
    let first = true;
    let hasCatchAll = false;
    for (const arm of e.arms) {
      const cond = this.armCond(arm.pattern, s);
      const bodyLines: string[] = [];
      this.armBinds(arm.pattern, s, `${ind}  `, bodyLines);
      bodyLines.push(this.stmt(arm.body, `${ind}  `));
      if (cond === "true") {
        hasCatchAll = true;
        out += `${ind}else {\n${bodyLines.join("\n")}\n${ind}}\n`;
      } else {
        out += `${ind}${first ? "if" : "else if"} (${cond}) {\n${bodyLines.join("\n")}\n${ind}}\n`;
        first = false;
      }
    }
    if (!hasCatchAll) {
      out += `${ind}else {\n${ind}  throw new Error("non-exhaustive match");\n${ind}}\n`;
    }
    return out;
  }

  private armCond(p: Pattern, s: string): string {
    switch (p.k) {
      case "wildcard":
      case "var":
        return "true";
      case "lit":
        return `${s} === ${litJs(p.value)}`;
      case "or":
        return p.patterns.map((sub) => `(${this.armCond(sub, s)})`).join(" || ");
      case "obj": {
        const conds = [`typeof ${s} === "object" && ${s} !== null && !Array.isArray(${s})`];
        for (const [n, sub] of p.fields) conds.push(`(${this.armCond(sub, `${s}.${jsName(n)}`)})`);
        return conds.join(" && ");
      }
      case "array": {
        const conds = [`Array.isArray(${s})`, `${s}.length === ${p.elements.length}`];
        p.elements.forEach((el, i) => conds.push(`(${this.armCond(el, `${s}[${i}]`)})`));
        return conds.join(" && ");
      }
    }
  }

  private armBinds(p: Pattern, s: string, ind: string, out: string[]): void {
    switch (p.k) {
      case "var":
        out.push(`${ind}const ${jsName(p.name)} = ${s};`);
        break;
      case "obj":
        for (const [n, sub] of p.fields) this.armBinds(sub, `${s}.${jsName(n)}`, ind, out);
        break;
      case "array":
        p.elements.forEach((el, i) => this.armBinds(el, `${s}[${i}]`, ind, out));
        break;
      default:
        break;
    }
  }

  expr(e: Core, ind: string): string {
    switch (e.k) {
      case "Lit":
        return litJs(e.value);
      case "Var":
        return this.varRef(e.name);
      case "Lam": {
        const params = e.params.map((p) => jsName(p.name)).join(", ");
        return `((${params}) => {\n${this.stmt(e.body, `${ind}  `)}\n${ind}})`;
      }
      case "App": {
        if (e.fn.k === "Var" && !this.userNames.has(e.fn.name)) {
          const n = e.fn.name;
          if (n === "bind" && e.args.length === 2) {
            return `(($b) => $b.tag === "Ok" ? (${this.expr(e.args[1], ind)})($b.value) : $b)(${this.expr(e.args[0], ind)})`;
          }
          if (n === "map-result" && e.args.length === 2) {
            return `(($b) => $b.tag === "Ok" ? ${this.runtimeRef("ok")}((${this.expr(e.args[1], ind)})($b.value)) : $b)(${this.expr(e.args[0], ind)})`;
          }
          if (n === "traverse" && e.args.length === 2) {
            return `(($arr) => { const $out = []; for (const $x of ${this.expr(e.args[0], ind)}) { const $r = (${this.expr(e.args[1], ind)})($x); if ($r.tag === "Err") return $r; $out.push($r.value); } return ${this.runtimeRef("ok")}($out); })()`;
          }
        }
        return `${this.expr(e.fn, ind)}(${e.args.map((a) => this.expr(a, ind)).join(", ")})`;
      }
      case "Let":
        return `((${jsName(e.name)}) => {\n${this.stmt(e.body, `${ind}  `)}\n${ind}})(${this.expr(e.rhs, ind)})`;
      case "If":
        return `(${this.expr(e.cond, ind)} ? ${this.expr(e.then, ind)} : ${this.expr(e.else, ind)})`;
      case "Match": {
        const s = `$s${this.fresh()}`;
        return `((${s}) => {\n${this.matchTail(e, `${ind}  `, s)}\n${ind}})(${this.expr(e.scrutinee, ind)})`;
      }
      case "Obj":
        return `{ ${e.fields.map(([n, c]) => `${jsName(n)}: ${this.expr(c, ind)}`).join(", ")} }`;
      case "Field":
        return `(${this.expr(e.obj, ind)}).${jsName(e.name)}`;
      case "Do":
        return `(() => {\n${this.doStmt(e, `${ind}  `)}\n${ind}})()`;
      case "EffectCall":
        return `(() => { throw new Error(${JSON.stringify(`エフェクト ${e.effect}! は P0 では実行できません`)}); })()`;
      case "Error":
        return `(() => { throw new Error(${JSON.stringify(e.message)}); })()`;
    }
  }
}
