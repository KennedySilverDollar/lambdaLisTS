import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { emit } from "../../src/backend/js";
import { RUNTIME_JS } from "../../src/backend/runtime";
import { desugar } from "../../src/core/desugar";
import type { CoreTopForm } from "../../src/core/desugar";
import { globalEnv, loadDefs, runExamples } from "../../src/interp/eval";
import type { Env } from "../../src/interp/env";
import type { Value } from "../../src/interp/value";
import { normalizeSource, tokenize } from "../../src/lexer/lexer";
import { resolveImportPath } from "../../src/modules/resolver";
import { parseProgram } from "../../src/parser/parser";
import { checkFile } from "../../src/types/check";

export const fixturePath = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

export interface Piped {
  defs: CoreTopForm[];
  source: string;
  abs: string;
}

export function pipelineFile(abs: string): Piped {
  const source = normalizeSource(readFileSync(abs, "utf8"));
  const lexed = tokenize(source, abs);
  const parsed = parseProgram(lexed);
  const ds = desugar(parsed.program);
  return { defs: ds.defs, source, abs };
}

export function newTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function compileToDir(names: string[], dir: string): void {
  writeFileSync(join(dir, "runtime.js"), RUNTIME_JS);
  for (const name of names) {
    const p = pipelineFile(fixturePath(name));
    const base = name.replace(/\.lts$/, "");
    const checked = checkFile(p.abs);
    const r = emit({
      defs: p.defs,
      source: p.source,
      file: `${base}.js`,
      sourceFile: name,
      typeNames: new Set(checked.typeAliases.keys()),
    });
    if ("errors" in r) throw new Error(`emit errors for ${name}: ${JSON.stringify(r.errors)}`);
    writeFileSync(join(dir, `${base}.js`), r.js);
    writeFileSync(join(dir, `${base}.js.map`), r.map);
  }
}

export function runNode(file: string, cwd: string): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [file], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function nodeExampleValues(dir: string, base: string, count: number): Value[] {
  const r = runNode(`${base}.js`, dir);
  if (r.status !== 0) throw new Error(`node ${base}.js failed (${r.status}): ${r.stderr}`);
  const values: Value[] = [];
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^example \d+: ok (.*)$/);
    if (m) values.push(JSON.parse(m[1]) as Value);
  }
  return values.slice(-count);
}

export function interpExampleValues(names: string[]): { pass: boolean; actual: Value }[] {
  const env: Env = globalEnv();
  const seen = new Set<string>();
  const ownDefs: CoreTopForm[] = [];
  const load = (abs: string, collect: boolean): void => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const p = pipelineFile(abs);
    for (const d of p.defs) {
      if (d.k === "import") {
        const t = resolveImportPath(abs, d.path);
        if (t) load(t, false);
      }
    }
    loadDefs(p.defs, env);
    if (collect) ownDefs.push(...p.defs);
  };
  for (const n of names) load(fixturePath(n), true);
  return runExamples(ownDefs, env);
}
