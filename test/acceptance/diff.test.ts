import { describe, expect, test } from "vitest";
import { structuralEqual, printValue, type Value } from "../../src/interp/value";
import {
  compileToDir,
  fixturePath,
  interpExampleValues,
  newTmpDir,
  nodeExampleValues,
  pipelineFile,
} from "./harness";

describe("T7: インタープリタと JS バックエンドの差分一致 (§13 T7)", () => {
  test.each(["money.lts", "cart.lts", "cart-spy.lts"])(
    "%s の全 example を (1) インタープリタ (2) node 実行 で評価し structuralEqual で一致",
    (name) => {
      const base = name.replace(/\.lts$/, "");
      const dir = newTmpDir("lists-diff-");
      const needsMoney = name !== "money.lts";
      compileToDir(needsMoney ? ["money.lts", name] : ["money.lts"], dir);
      const p = pipelineFile(fixturePath(name));
      const exampleCount = p.defs.filter((d) => d.k === "example").length;
      expect(exampleCount).toBeGreaterThanOrEqual(1);
      const jsValues: Value[] = nodeExampleValues(dir, base, exampleCount);
      const interp = interpExampleValues([name]);
      expect(interp).toHaveLength(exampleCount);
      expect(jsValues).toHaveLength(exampleCount);
      for (let i = 0; i < exampleCount; i++) {
        expect(interp[i].pass, `interp example ${i} が pass していない`).toBe(true);
        expect(
          structuralEqual(interp[i].actual, jsValues[i]),
          `example ${i} が不一致:
interp: ${printValue(interp[i].actual)}
js:    ${JSON.stringify(jsValues[i])}`,
        ).toBe(true);
      }
    },
  );
});
