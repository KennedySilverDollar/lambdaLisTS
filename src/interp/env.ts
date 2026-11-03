import type { Value } from "./value.js";

export class Env {
  private vars = new Map<string, Value>();

  constructor(readonly parent: Env | null = null) {}

  define(name: string, value: Value): void {
    this.vars.set(name, value);
  }

  lookup(name: string): Value | undefined {
    for (let e: Env | null = this; e !== null; e = e.parent) {
      const v = e.vars.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  child(): Env {
    return new Env(this);
  }
}
