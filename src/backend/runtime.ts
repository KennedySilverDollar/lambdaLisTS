export const RUNTIME_JS = `export const ok = (value) => ({ tag: "Ok", value });
export const err = (value) => ({ tag: "Err", value });
export function structuralEqual(a, b) {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => structuralEqual(x, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => k in b && structuralEqual(a[k], b[k]));
  }
  return a === b;
}
`;
