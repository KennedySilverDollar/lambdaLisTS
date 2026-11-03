import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { checkImportNames, ModuleGraph, resolveImportPath, type ModuleInfo } from "../src/modules/resolver";
import { checkFile } from "../src/types/check";

const fixturePath = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("モジュール解決 (§3.8)", () => {
  test("resolveImportPath: ./ ../ は .lts 解決、パッケージ名は null (P1)", () => {
    expect(resolveImportPath("/a/b/c.lts", "./x.lts")).toBe("/a/b/x.lts");
    expect(resolveImportPath("/a/b/c.lts", "../y")).toBe("/a/y.lts");
    expect(resolveImportPath("/a/b/c.lts", "some-pkg")).toBe(null);
  });

  test("付録A: cart.lts が money.lts を import して診断ゼロ", () => {
    const r = checkFile(fixturePath("cart.lts"));
    expect(r.diagnostics).toEqual([]);
  });

  test("export された値の import → 診断ゼロ（mod-use-ok.lts）", () => {
    const r = checkFile(fixturePath("mod-use-ok.lts"));
    expect(r.diagnostics).toEqual([]);
  });

  test("未 export の値の import → not-exported（mod-use-bad.lts の hidden）", () => {
    const r = checkFile(fixturePath("mod-use-bad.lts"));
    const d = r.diagnostics.find((d) => d.kind === "not-exported");
    expect(d).toBeDefined();
    expect(d?.message).toContain("hidden");
    expect((d?.data as { name: string }).name).toBe("hidden");
  });

  test("型名前空間も import 対象（§6.6）: 未 export の型 T を import しても診断ゼロ", () => {
    const r = checkFile(fixturePath("mod-use-type.lts"));
    expect(r.diagnostics).toEqual([]);
  });

  test("存在しないファイル → import-not-found", () => {
    const r = checkFile(fixturePath("mod-missing.lts"));
    expect(r.diagnostics.some((d) => d.kind === "import-not-found")).toBe(true);
  });

  test("付録B cycle-a/b → module-cycle（DFS 循環検出）", () => {
    for (const name of ["cycle-a.lts", "cycle-b.lts"]) {
      const r = checkFile(fixturePath(name));
      expect(r.diagnostics.some((d) => d.kind === "module-cycle"), name).toBe(true);
    }
  });

  test("ModuleGraph: DFS スタックで循環を検出", () => {
    const g = new ModuleGraph();
    g.enter("/a.lts");
    expect(g.isOnStack("/a.lts")).toBe(true);
    g.enter("/b.lts");
    expect(g.isOnStack("/a.lts")).toBe(true);
    expect(g.isOnStack("/c.lts")).toBe(false);
    g.leave("/b.lts");
    expect(g.isOnStack("/b.lts")).toBe(false);
    expect(g.isOnStack("/a.lts")).toBe(true);
  });

  test("checkImportNames 単体: export/未 export/不存在/型", () => {
    const mod: ModuleInfo = {
      exports: ["pub"],
      valueNames: new Set(["pub", "hidden"]),
      typeNames: new Set(["T"]),
      effectNames: new Set(["log"]),
    };
    const span = { file: "t.lts", start: 0, end: 1, line: 1, col: 1 };
    expect(checkImportNames(mod, ["pub", "T"], span, "./m.lts", "p")).toEqual([]);
    const bad = checkImportNames(mod, ["hidden", "log", "nope"], span, "./m.lts", "p");
    expect(bad.map((d) => d.kind)).toEqual(["not-exported", "not-exported", "unbound-symbol"]);
  });
});
