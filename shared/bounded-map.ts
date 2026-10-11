export class BoundedMap<K, V> {
  readonly limit: number;
  private readonly entries = new Map<K, V>();

  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): this {
    this.entries.delete(key);
    this.entries.set(key, value);
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.limit) break;
      this.entries.delete(oldest);
    }
    return this;
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  keys(): IterableIterator<K> {
    return this.entries.keys();
  }
}
