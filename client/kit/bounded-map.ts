export type BoundedMap<K, V> = {
  readonly limit: number;
  get(key: K): V | undefined;
  set(key: K, value: V): BoundedMap<K, V>;
  delete(key: K): boolean;
  keys(): IterableIterator<K>;
};

export function boundedMap<K, V>(limit: number): BoundedMap<K, V> {
  const entries = new Map<K, V>();
  const map: BoundedMap<K, V> = {
    limit,
    get(key) {
      if (!entries.has(key)) return undefined;
      const value = entries.get(key) as V;
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, value);
      for (const oldest of entries.keys()) {
        if (entries.size <= limit) break;
        entries.delete(oldest);
      }
      return map;
    },
    delete: (key) => entries.delete(key),
    keys: () => entries.keys(),
  };
  return map;
}
