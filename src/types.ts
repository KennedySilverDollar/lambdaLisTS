export type Type =
  | { k: "number" }
  | { k: "string" }
  | { k: "bool" }
  | { k: "nil" }
  | { k: "literal"; value: string }
  | { k: "array"; element: Type }
  | { k: "union"; members: Type[] }
  | { k: "obj"; fields: Map<string, Type> }
  | { k: "result"; ok: Type; err: Type }
  | { k: "fn"; params: Type[]; ret: Type }
  | { k: "var"; id: number }
  | { k: "alias"; name: string };

export type Scheme = { vars: number[]; body: Type };
