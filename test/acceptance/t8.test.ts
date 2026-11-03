import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compileToDir, newTmpDir, runNode } from "./harness";

describe("T8: source map（§10.4）", () => {
  test("深い再帰のスタックトレースが .lts の行・列を指し、関数名 add-money が表示される", () => {
    const dir = newTmpDir("lists-t8-");
    compileToDir(["deep-add.lts"], dir);
    writeFileSync(
      join(dir, "driver.js"),
      'import { add_money } from "./deep-add.js";\nadd_money(1000000);\n',
    );
    const r = runNode("driver.js", dir, ["--enable-source-maps"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Maximum call stack size exceeded");
    const frames = r.stderr.split("\n").filter((l) => l.includes("at "));
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]).toMatch(/at add-money \(.*deep-add\.lts:\d+:\d+\)/);
    expect(frames.some((f) => /deep-add\.lts:4:\d+/.test(f))).toBe(true);
  });

  test("source map の names に元の関数名が入っている", () => {
    const dir = newTmpDir("lists-t8b-");
    compileToDir(["deep-add.lts"], dir);
    const map = JSON.parse(readFileSync(join(dir, "deep-add.js.map"), "utf8"));
    expect(map.names).toContain("add-money");
    expect(map.sources).toEqual(["deep-add.lts"]);
    expect(map.version).toBe(3);
  });
});
