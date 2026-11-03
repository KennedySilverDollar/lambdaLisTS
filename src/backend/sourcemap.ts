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
