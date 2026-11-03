import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const cliEntry = fileURLToPath(new URL("../../dist/tools/cli.js", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

function ensureBuilt(): void {
  if (!existsSync(cliEntry)) {
    const r = spawnSync("npm", ["run", "build"], { cwd: repoRoot, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`build failed: ${r.stderr}`);
  }
}

describe("T9: REPL JSON 往復（§10.1, §13 T9）— 実 CLI プロセスで検証", () => {
  test("eval / test / prop / type-of / quit の1行1JSON往復", () => {
    ensureBuilt();
    const input = [
      '{"id": 1, "op": "eval", "src": "(defn add (a : number) (b : number) : number (+ a b))"}',
      '{"id": 2, "op": "test"}',
      '{"id": 3, "op": "prop", "name": "add-money commutative"}',
      '{"id": 5, "op": "type-of", "src": "add"}',
      '{"id": 6, "op": "quit"}',
    ].join("\n") + "\n";
    const r = spawnSync(process.execPath, [cliEntry, "repl"], { cwd: repoRoot, encoding: "utf8", input });
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { id: 1, ok: true, defined: "add", type: "(fn (number number) : number)" },
      { id: 2, ok: true, results: [] },
      { id: 3, ok: false, errors: [{ kind: "unsupported-in-p0", message: "prop評価はP1で実装" }] },
      { id: 5, ok: true, type: "(fn (number number) : number)" },
    ]);
  });

  test("eval で型エラー → ok:false + errors（JSON往復）", () => {
    ensureBuilt();
    const input = '{"id": 1, "op": "eval", "src": "(defn f () : number (ok \\"a\\"))"}\n{"id": 6, "op": "quit"}\n';
    const r = spawnSync(process.execPath, [cliEntry, "repl"], { cwd: repoRoot, encoding: "utf8", input });
    expect(r.status).toBe(0);
    const first = JSON.parse(r.stdout.trim().split("\n")[0]);
    expect(first.ok).toBe(false);
    expect(first.errors[0].kind).toBe("type-mismatch");
    expect(first.errors[0].data.expected).toBe("number");
  });
});
