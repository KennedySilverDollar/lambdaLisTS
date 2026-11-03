import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { emit } from "../backend/js.js";
import { RUNTIME_JS } from "../backend/runtime.js";
import type { Diagnostic } from "../diagnostic.js";
import { desugar } from "../core/desugar.js";
import { normalizeSource, tokenize } from "../lexer/lexer.js";
import { parseProgram } from "../parser/parser.js";
import { checkFile } from "../types/check.js";
import { formatSource } from "./fmt.js";
import { Repl } from "./repl.js";

export async function runCli(argv: string[], cwd = process.cwd()): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "compile":
      return compileCmd(rest, cwd);
    case "fmt":
      return fmtCmd(rest, cwd);
    case "repl":
      return replCmd();
    default:
      process.stdout.write("usage: lists <compile|fmt|repl> ...\n");
      return 2;
  }
}

function outPathFor(file: string, outDir: string | null): string {
  const base = basename(file).replace(/\.lts$/, ".js");
  return outDir === null ? join(dirname(file), base) : join(outDir, base);
}

async function compileCmd(args: string[], cwd: string): Promise<number> {
  const files: string[] = [];
  let outDir: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      outDir = resolve(cwd, args[++i]);
    } else {
      files.push(resolve(cwd, args[i]));
    }
  }
  const diagnostics: Diagnostic[] = [];
  const outRoot = outDir ?? (files.length > 0 ? dirname(files[0]) : cwd);
  if (outDir !== null) mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const source = normalizeSource(readFileSync(file, "utf8"));
    const lexed = tokenize(source, file);
    const parsed = parseProgram(lexed);
    const ds = desugar(parsed.program);
    diagnostics.push(...lexed.diagnostics, ...parsed.diagnostics, ...ds.diagnostics);
    const checked = checkFile(file);
    diagnostics.push(...checked.diagnostics);
    const result = emit({
      defs: ds.defs,
      source,
      file: basename(outPathFor(file, outDir)),
      sourceFile: basename(file),
      typeNames: new Set(checked.typeAliases.keys()),
    });
    if ("errors" in result) {
      diagnostics.push(...result.errors);
      continue;
    }
    const out = outPathFor(file, outDir);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, result.js);
    writeFileSync(`${out}.map`, result.map);
  }
  if (!existsSync(join(outRoot, "runtime.js"))) {
    writeFileSync(join(outRoot, "runtime.js"), RUNTIME_JS);
  }
  process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
  return diagnostics.length > 0 ? 1 : 0;
}

async function fmtCmd(args: string[], cwd: string): Promise<number> {
  const diagnostics: Diagnostic[] = [];
  for (const arg of args) {
    const file = resolve(cwd, arg);
    const src = readFileSync(file, "utf8");
    const r = formatSource(src, file);
    diagnostics.push(...r.diagnostics);
    if (r.diagnostics.length === 0) writeFileSync(file, r.output);
  }
  process.stdout.write(`${JSON.stringify(diagnostics)}\n`);
  return diagnostics.length > 0 ? 1 : 0;
}

async function replCmd(): Promise<number> {
  const repl = new Repl();
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let out: string | null;
    try {
      out = repl.handleLine(trimmed);
    } catch (e) {
      out = JSON.stringify({ ok: false, errors: [{ kind: "internal-error", message: String(e) }] });
    }
    if (out === null) break;
    process.stdout.write(`${out}\n`);
  }
  return 0;
}

const invokedAsMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
