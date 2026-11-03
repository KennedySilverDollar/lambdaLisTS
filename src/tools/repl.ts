import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desugar, desugarExpr } from "../core/desugar.js";
import type { CoreTopForm } from "../core/desugar.js";
import { globalEnv, loadDefs, runExamples } from "../interp/eval.js";
import type { Env } from "../interp/env.js";
import { printValue } from "../interp/value.js";
import { normalizeSource, tokenize } from "../lexer/lexer.js";
import { resolveImportPath } from "../modules/resolver.js";
import { parseExpr, parseProgram } from "../parser/parser.js";
import { checkFile, createContext } from "../types/check.js";
import { normalizeType, printType } from "../types/type.js";

export type ReplRequest = { id: number; op: string; src?: string; file?: string; name?: string };
export type ReplResponse = Record<string, unknown>;

export class Repl {
  private defs: CoreTopForm[] = [];
  private contextFile = "repl.lts";
  private env: Env = globalEnv();

  handle(input: ReplRequest): ReplResponse | null {
    const id = input.id;
    switch (input.op) {
      case "quit":
        return null;
      case "eval":
        return this.eval(id, input.src ?? "");
      case "test":
        return this.test(id);
      case "prop":
        return {
          id,
          ok: false,
          errors: [{ kind: "unsupported-in-p0", message: "prop評価はP1で実装" }],
        };
      case "reload":
        return this.reload(id, input.file ?? "");
      case "type-of":
        return this.typeOf(id, input.src ?? "");
      default:
        return { id, ok: false, errors: [{ kind: "parse-error", message: `unknown op: ${input.op}` }] };
    }
  }

  handleLine(line: string): string | null {
    const req = JSON.parse(line) as ReplRequest;
    const res = this.handle(req);
    return res === null ? null : JSON.stringify(res);
  }

  private context() {
    const ctx = createContext(this.defs, this.contextFile);
    return { all: this.defs, ctx };
  }

  private eval(id: number, src: string): ReplResponse {
    const parsed = parseProgram(tokenize(src, "repl.lts"));
    if (parsed.diagnostics.length > 0) return { id, ok: false, errors: parsed.diagnostics };
    const ds = desugar(parsed.program);
    if (ds.diagnostics.length > 0) return { id, ok: false, errors: ds.diagnostics };
    const ctx = createContext([...this.defs, ...ds.defs], this.contextFile);
    if (ctx.diagnostics.length > 0) {
      return { id, ok: false, errors: ctx.diagnostics };
    }
    this.defs = [...this.defs, ...ds.defs];
    loadDefs(ds.defs, this.env);
    const defn = [...ds.defs].reverse().find((d) => d.k === "defn");
    if (defn && defn.k === "defn") {
      const t = ctx.valueTypes.get(defn.name);
      return {
        id,
        ok: true,
        defined: defn.name,
        type: t ? printType(normalizeType(t, ctx.typeAliases), ctx.typeAliases) : "?",
      };
    }
    return { id, ok: true };
  }

  private test(id: number): ReplResponse {
    const { all } = this.context();
    loadDefs(all, this.env);
    const results = runExamples(all, this.env);
    if (results.every((r) => r.pass)) {
      return {
        id,
        ok: true,
        results: results.map((r) => ({ example: `example ${r.index}`, pass: r.pass })),
      };
    }
    return {
      id,
      ok: false,
      failures: results
        .filter((r) => !r.pass)
        .map((r) => ({
          example: `example ${r.index}`,
          actual: printValue(r.actual),
          expected: printValue(r.expected),
        })),
    };
  }

  private reload(id: number, file: string): ReplResponse {
    const abs = resolve(file);
    const checked = checkFile(abs);
    if (checked.diagnostics.length > 0) return { id, ok: false, errors: checked.diagnostics };
    const seen = new Set<string>();
    const loadModule = (path: string): CoreTopForm[] => {
      if (seen.has(path)) return [];
      seen.add(path);
      const src = normalizeSource(readFileSync(path, "utf8"));
      const ds = desugar(parseProgram(tokenize(src, path)).program);
      for (const d of ds.defs) {
        if (d.k === "import") {
          const target = resolveImportPath(path, d.path);
          if (target) loadModule(target);
        }
      }
      loadDefs(ds.defs, this.env);
      return ds.defs;
    };
    const defs = loadModule(abs);
    this.defs = [...this.defs, ...defs];
    this.contextFile = abs;
    return { id, ok: true };
  }

  private typeOf(id: number, src: string): ReplResponse {
    const parsed = parseExpr(src, "repl.lts");
    if (parsed.diagnostics.length > 0) return { id, ok: false, errors: parsed.diagnostics };
    if (!parsed.expr) return { id, ok: false, errors: [{ kind: "parse-error", message: "式としてパースできません" }] };
    const core = desugarExpr(parsed.expr);
    const { ctx } = this.context();
    if (ctx.diagnostics.length > 0) return { id, ok: false, errors: ctx.diagnostics };
    const t = ctx.infer(core);
    return { id, ok: true, type: printType(normalizeType(t, ctx.typeAliases), ctx.typeAliases) };
  }
}
