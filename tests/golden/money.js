import { ok, err, structuralEqual } from "./runtime.js";
const $stdlib_add = (a, b) => a + b;
const $stdlib_eq = (a, b) => structuralEqual(a, b);
const $stdlib_str_concat = (...a) => a.join("");

export function zero() {
  return { amount: 0, currency: "JPY" };
}
export function add_money(a, b) {
  if ($stdlib_eq((a).currency, (b).currency)) {
    return ok({ amount: $stdlib_add((a).amount, (b).amount), currency: (a).currency });

  } else {
    return err($stdlib_str_concat("currency mismatch: ", (a).currency, " vs ", (b).currency));

  }
}
{
  const actual = add_money({ amount: 1, currency: "JPY" }, { amount: 2, currency: "JPY" });
  const expected = ok({ amount: 3, currency: "JPY" });
  if (!structuralEqual(actual, expected)) throw new Error("example 0 failed: " + JSON.stringify(actual));
  console.log("example 0: ok " + JSON.stringify(actual));
}

//# sourceMappingURL=money.js.map
