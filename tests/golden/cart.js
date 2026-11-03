import { ok, err, structuralEqual } from "./runtime.js";
const $stdlib_mul = (a, b) => a * b;
const $stdlib_lt = (a, b) => a < b;
const $stdlib_eq = (a, b) => structuralEqual(a, b);
const $stdlib_array = (...a) => a;
const $stdlib_count = (arr) => arr.length;
const $stdlib_find = (arr, f) => { for (const x of arr) if (f(x)) return ok(x); return null; };
const $stdlib_fold_left = (arr, init, f) => arr.reduce((acc, x) => f(acc, x), init);

import { add_money, zero } from "./money.js";
function check_items(items) {
  if ($stdlib_eq($stdlib_count(items), 0)) {
    return err({ tag: "EmptyCart" });

  } else {
    const $s1 = $stdlib_find(items, ((i) => {
      return $stdlib_lt((i).qty, 0);
    }));
    if ($s1 === null) {
      return ok(null);

    }
    else {
      const i = $s1;
      return err({ tag: "NegativeQty", id: (i).id });

    }

  }
}
function total(items) {
  return $stdlib_fold_left(items, ok(zero()), ((acc, i) => {
    return (($b) => $b.tag === "Ok" ? (((m) => {
      return add_money(m, { amount: $stdlib_mul(((i).price).amount, (i).qty), currency: ((i).price).currency });
    }))($b.value) : $b)(acc);
  }));
}
export function place_order(items) {
  const $r2 = check_items(items);
  if ($r2.tag === "Err") return $r2;
  const $r3 = total(items);
  if ($r3.tag === "Err") return $r3;
  const t = $r3.value;
  return ok(t);
}
{
  const actual = place_order($stdlib_array());
  const expected = err({ tag: "EmptyCart" });
  if (!structuralEqual(actual, expected)) throw new Error("example 0 failed: " + JSON.stringify(actual));
  console.log("example 0: ok " + JSON.stringify(actual));
}

//# sourceMappingURL=cart.js.map
