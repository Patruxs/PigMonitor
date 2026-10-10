export class BoundedMap<K, V> extends Map<K, V> {
  readonly limit: number;

  constructor(limit: number) {
    super();
    this.limit = limit;
  }

  override get(key: K): V | undefined {
    if (!super.has(key)) return undefined;
    const value = super.get(key) as V;
    super.delete(key);
    super.set(key, value);
    return value;
  }

  override set(key: K, value: V): this {
    super.delete(key);
    super.set(key, value);
    for (const oldest of this.keys()) {
      if (this.size <= this.limit) break;
      super.delete(oldest);
    }
    return this;
  }
}
