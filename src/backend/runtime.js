export const ok = (value) => ({ tag: "Ok", value });
export const err = (value) => ({ tag: "Err", value });

const CYCLIC_EQ_MESSAGE = "lists runtime-error: cyclic structure in `=` (SPEC 8.3/8.6)";

export function structuralEqual(a, b) {
  return eqVisit(a, b, []);
}

function eqVisit(a, b, path) {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return eqComposite(a, b, path, () => a.every((x, i) => eqVisit(x, b[i], path)));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return eqComposite(a, b, path, () => ka.every((k) => k in b && eqVisit(a[k], b[k], path)));
  }
  return a === b;
}

function eqComposite(a, b, path, children) {
  for (const p of path) {
    if (p[0] === a && p[1] === b) throw new Error(CYCLIC_EQ_MESSAGE);
  }
  path.push([a, b]);
  try {
    return children();
  } finally {
    path.pop();
  }
}
