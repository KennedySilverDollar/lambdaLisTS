import MagicString from "magic-string";

export interface SourceEmitter {
  remove(start: number, end: number): void;
  overwrite(start: number, end: number, content: string): void;
  prepend(content: string): void;
  toString(): string;
  map(file: string, sourceFile: string): string;
}

export function createEmitter(source: string): SourceEmitter {
  const ms = new MagicString(source);
  return {
    remove: (start, end) => ms.remove(start, end),
    overwrite: (start, end, content) => ms.overwrite(start, end, content),
    prepend: (content) => ms.prepend(content),
    toString: () => ms.toString(),
    map: (file, sourceFile) => ms.generateMap({ hires: true, file, source: sourceFile }).toString(),
  };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64V = new Map<string, number>([...B64].map((c, i) => [c, i]));

function encodeVlq(v: number): string {
  let vlq = v < 0 ? -v * 2 + 1 : v * 2;
  let s = "";
  do {
    let digit = vlq % 32;
    vlq = Math.floor(vlq / 32);
    if (vlq > 0) digit += 32;
    s += B64[digit];
  } while (vlq > 0);
  return s;
}

function decodeMappings(mappings: string): number[][][] {
  const lines: number[][][] = [];
  let src = 0;
  let origLine = 0;
  let origCol = 0;
  let name = 0;
  for (const lineStr of mappings.split(";")) {
    const segs: number[][] = [];
    let genCol = 0;
    if (lineStr.length > 0) {
      for (const segStr of lineStr.split(",")) {
        const vals: number[] = [];
        let shift = 0;
        let value = 0;
        for (const ch of segStr) {
          const digit = B64V.get(ch)!;
          value += (digit % 32) * 2 ** shift;
          if (digit >= 32) {
            shift += 5;
          } else {
            const neg = value % 2 === 1;
            value = Math.floor(value / 2);
            vals.push(neg ? -value : value);
            value = 0;
            shift = 0;
          }
        }
        genCol += vals[0];
        const seg = [genCol];
        if (vals.length >= 4) {
          src += vals[1];
          origLine += vals[2];
          origCol += vals[3];
          seg.push(src, origLine, origCol);
          if (vals.length === 5) {
            name += vals[4];
            seg.push(name);
          }
        }
        segs.push(seg);
      }
    }
    lines.push(segs);
  }
  return lines;
}

function encodeMappings(lines: number[][][]): string {
  let src = 0;
  let origLine = 0;
  let origCol = 0;
  let name = 0;
  const out: string[] = [];
  for (const segs of lines) {
    let genCol = 0;
    const parts: string[] = [];
    for (const seg of segs) {
      let s = encodeVlq(seg[0] - genCol);
      genCol = seg[0];
      if (seg.length >= 4) {
        s += encodeVlq(seg[1] - src) + encodeVlq(seg[2] - origLine) + encodeVlq(seg[3] - origCol);
        src = seg[1];
        origLine = seg[2];
        origCol = seg[3];
        if (seg.length === 5) {
          s += encodeVlq(seg[4] - name);
          name = seg[4];
        }
      }
      parts.push(s);
    }
    out.push(parts.join(","));
  }
  return out.join(";");
}

export function injectFunctionNames(
  js: string,
  mapJson: string,
  pairs: { js: string; original: string }[],
): string {
  if (pairs.length === 0) return mapJson;
  const map = JSON.parse(mapJson) as { names?: string[]; mappings: string };
  const names: string[] = map.names ?? [];
  const nameIdx = new Map<string, number>();
  const idxOf = (n: string): number => {
    const hit = nameIdx.get(n);
    if (hit !== undefined) return hit;
    const i = names.length;
    names.push(n);
    nameIdx.set(n, i);
    return i;
  };
  const lines = decodeMappings(map.mappings);
  const jsLines = js.split("\n");
  for (const { js: fnJs, original } of pairs) {
    const needle = `function ${fnJs}(`;
    for (let i = 0; i < jsLines.length; i++) {
      if (!jsLines[i].includes(needle)) continue;
      const idx = idxOf(original);
      let j = i;
      for (; j < jsLines.length; j++) {
        const segs = lines[j] ?? [];
        if (segs.length > 0) {
          if (segs[0].length === 4) segs[0].push(idx);
          else segs[0][4] = idx;
        }
        if (jsLines[j] === "}") break;
      }
      i = j;
    }
  }
  return JSON.stringify({ ...map, names, mappings: encodeMappings(lines) });
}
