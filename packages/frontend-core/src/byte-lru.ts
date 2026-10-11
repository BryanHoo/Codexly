const textEncoder = new TextEncoder();

const ARRAY_BASE_BYTES = 32;
const ARRAY_SLOT_BYTES = 8;
const OBJECT_BASE_BYTES = 48;
const OBJECT_PROPERTY_BYTES = 16;
const STRING_BASE_BYTES = 16;

export function getUtf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

/**
 * 以可序列化 Payload 为主体进行保守估算，避免为了容量统计创建完整 JSON 副本。
 */
export function estimateRetainedBytes(value: unknown): number {
  const visitedObjects = new WeakSet<object>();

  function estimate(currentValue: unknown): number {
    if (currentValue === null || currentValue === undefined) {
      return 8;
    }
    if (typeof currentValue === "string") {
      return STRING_BASE_BYTES + getUtf8ByteLength(currentValue);
    }
    if (typeof currentValue === "number" || typeof currentValue === "bigint") {
      return 8;
    }
    if (typeof currentValue === "boolean") {
      return 4;
    }
    if (typeof currentValue === "symbol" || typeof currentValue === "function") {
      return 16;
    }
    if (visitedObjects.has(currentValue)) {
      return 0;
    }
    visitedObjects.add(currentValue);

    if (Array.isArray(currentValue)) {
      let retainedBytes = ARRAY_BASE_BYTES + currentValue.length * ARRAY_SLOT_BYTES;
      for (const item of currentValue) {
        retainedBytes += estimate(item);
      }
      return retainedBytes;
    }

    let retainedBytes = OBJECT_BASE_BYTES;
    for (const [propertyName, propertyValue] of Object.entries(currentValue)) {
      retainedBytes +=
        OBJECT_PROPERTY_BYTES + getUtf8ByteLength(propertyName) + estimate(propertyValue);
    }
    return retainedBytes;
  }

  return estimate(value);
}

type ByteLruEntry<Value> = Readonly<{
  retainedBytes: number;
  value: Value;
}>;

export type ByteLruEvictionReason = "bytes" | "entries" | "replaced";

export type ByteLruOptions<Key, Value> = Readonly<{
  getRetainedBytes: (key: Key, value: Value) => number;
  maxBytes: number;
  maxEntries?: number;
  onEvict?: (key: Key, value: Value, reason: ByteLruEvictionReason) => void;
}>;

export class ByteLru<Key, Value> {
  readonly #entries = new Map<Key, ByteLruEntry<Value>>();
  readonly #getRetainedBytes: (key: Key, value: Value) => number;
  readonly #maxBytes: number;
  readonly #maxEntries: number;
  readonly #onEvict: ByteLruOptions<Key, Value>["onEvict"];
  #retainedBytes = 0;

  public constructor(options: ByteLruOptions<Key, Value>) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
      throw new RangeError("Byte LRU maxBytes must be a non-negative safe integer");
    }
    const maxEntries = options.maxEntries ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0) {
      throw new RangeError("Byte LRU maxEntries must be a non-negative safe integer");
    }
    this.#getRetainedBytes = options.getRetainedBytes;
    this.#maxBytes = options.maxBytes;
    this.#maxEntries = maxEntries;
    this.#onEvict = options.onEvict;
  }

  public get retainedBytes(): number {
    return this.#retainedBytes;
  }

  public get size(): number {
    return this.#entries.size;
  }

  public delete(key: Key): boolean {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return false;
    }
    this.#entries.delete(key);
    this.#retainedBytes -= entry.retainedBytes;
    return true;
  }

  public get(key: Key): Value | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      return undefined;
    }
    // Map 的迭代顺序即 LRU 顺序，命中后移动到最新位置。
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  public peek(key: Key): Value | undefined {
    return this.#entries.get(key)?.value;
  }

  public set(key: Key, value: Value): boolean {
    const retainedBytes = this.#getRetainedBytes(key, value);
    if (!Number.isSafeInteger(retainedBytes) || retainedBytes < 0) {
      throw new RangeError("Byte LRU entry size must be a non-negative safe integer");
    }

    const previousEntry = this.#entries.get(key);
    if (previousEntry !== undefined) {
      this.#entries.delete(key);
      this.#retainedBytes -= previousEntry.retainedBytes;
      this.#onEvict?.(key, previousEntry.value, "replaced");
    }
    if (retainedBytes > this.#maxBytes || this.#maxEntries === 0) {
      return false;
    }

    this.#entries.set(key, { retainedBytes, value });
    this.#retainedBytes += retainedBytes;
    this.#evictToBudget();
    return this.#entries.has(key);
  }

  #evictToBudget(): void {
    while (this.#entries.size > this.#maxEntries || this.#retainedBytes > this.#maxBytes) {
      const oldestEntry = this.#entries.entries().next().value as
        readonly [Key, ByteLruEntry<Value>] | undefined;
      if (oldestEntry === undefined) {
        return;
      }
      const [key, entry] = oldestEntry;
      this.#entries.delete(key);
      this.#retainedBytes -= entry.retainedBytes;
      this.#onEvict?.(
        key,
        entry.value,
        this.#entries.size >= this.#maxEntries ? "entries" : "bytes",
      );
    }
  }
}
