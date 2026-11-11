/**
 * A tiny typed registry used for anything extensible: brain regions, species presets,
 * technologies, metrics. Extensions register here instead of editing the engine.
 */
export class Registry<T> {
  readonly kind: string;
  #items = new Map<string, T>();

  constructor(kind: string) {
    this.kind = kind;
  }

  register(id: string, item: T): void {
    if (this.#items.has(id)) {
      throw new Error(`Duplicate ${this.kind} id "${id}"`);
    }
    this.#items.set(id, item);
  }

  /** Register only if the id is free (used when presets may be re-imported). */
  ensure(id: string, item: T): T {
    const existing = this.#items.get(id);
    if (existing) return existing;
    this.#items.set(id, item);
    return item;
  }

  get(id: string): T {
    const item = this.#items.get(id);
    if (!item) {
      throw new Error(
        `Unknown ${this.kind} "${id}". Known ids: ${this.ids().join(', ') || '(none)'}`,
      );
    }
    return item;
  }

  has(id: string): boolean {
    return this.#items.has(id);
  }

  ids(): string[] {
    return [...this.#items.keys()];
  }

  entries(): [string, T][] {
    return [...this.#items.entries()];
  }

  values(): T[] {
    return [...this.#items.values()];
  }
}

/** Deterministic djb2 hash of arbitrary JSON-able data, used for run digests. */
export const digest = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (Math.imul(h1, 33) ^ c) >>> 0;
    h2 = (Math.imul(h2, 31) ^ c) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
};
