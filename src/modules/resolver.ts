import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Diagnostic } from "../diagnostic.js";
import type { Span } from "../lexer/token.js";

export function resolveImportPath(fromFile: string, importPath: string): string | null {
  if (!importPath.startsWith("./") && !importPath.startsWith("../")) return null;
  const base = resolve(dirname(fromFile), importPath);
  return base.endsWith(".lts") ? base : `${base}.lts`;
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export class ModuleGraph {
  private stack: string[] = [];

  isOnStack(path: string): boolean {
    return this.stack.includes(path);
  }

  enter(path: string): void {
    this.stack.push(path);
  }

  leave(path: string): void {
    this.stack.pop();
  }

  get stackPaths(): readonly string[] {
    return this.stack;
  }
}

export interface ModuleInfo {
  exports: string[];
  valueNames: Set<string>;
  typeNames: Set<string>;
  effectNames: Set<string>;
}

export function importNotFound(span: Span, importPath: string, path: string): Diagnostic {
  return {
    kind: "import-not-found",
    severity: "error",
    span,
    message: `import 先が見つかりません: '${importPath}'`,
    data: { path, import: importPath },
  };
}

export function moduleCycle(span: Span, importPath: string, path: string): Diagnostic {
  return {
    kind: "module-cycle",
    severity: "error",
    span,
    message: `循環 import です: '${importPath}'`,
    data: { path, import: importPath },
  };
}

export function notExported(span: Span, name: string, importPath: string, path: string): Diagnostic {
  return {
    kind: "not-exported",
    severity: "error",
    span,
    message: `'${name}' は '${importPath}' で export されていません (§3.8)`,
    data: { path, name, import: importPath },
    fix: { op: "insert", path, template: name },
  };
}

export function checkImportNames(
  mod: ModuleInfo,
  names: string[],
  span: Span,
  importPath: string,
  path: string,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const name of names) {
    if (mod.typeNames.has(name)) continue;
    if (mod.valueNames.has(name) || mod.effectNames.has(name)) {
      if (!mod.exports.includes(name)) diags.push(notExported(span, name, importPath, path));
      continue;
    }
    diags.push({
      kind: "unbound-symbol",
      severity: "error",
      span,
      message: `モジュール '${importPath}' に '${name}' が存在しません`,
      data: { path, name },
    });
  }
  return diags;
}
