export class RingBuffer<Value> {
  readonly #capacity: number;
  #entries: (Value | undefined)[];
  #size = 0;
  #start = 0;

  public constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
      throw new RangeError("Ring buffer capacity must be a non-negative safe integer");
    }
    this.#capacity = capacity;
    this.#entries = new Array<Value | undefined>(capacity);
  }

  public get size(): number {
    return this.#size;
  }

  public append(value: Value): Value | undefined {
    if (this.#capacity === 0) return value;

    if (this.#size === this.#capacity) {
      const evicted = this.#entries[this.#start];
      this.#entries[this.#start] = value;
      this.#start = (this.#start + 1) % this.#capacity;
      return evicted;
    }

    const insertionIndex = (this.#start + this.#size) % this.#capacity;
    this.#entries[insertionIndex] = value;
    this.#size += 1;
    return undefined;
  }

  public clear(): void {
    this.#entries = new Array<Value | undefined>(this.#capacity);
    this.#size = 0;
    this.#start = 0;
  }

  public evictOldest(): Value | undefined {
    if (this.#size === 0) return undefined;

    const evicted = this.#entries[this.#start];
    this.#entries[this.#start] = undefined;
    // 只移动读指针，避免高频淘汰触发数组元素搬移。
    this.#start = (this.#start + 1) % this.#capacity;
    this.#size -= 1;
    return evicted;
  }

  public forEach(visit: (value: Value) => void): void {
    for (let offset = 0; offset < this.#size; offset += 1) {
      const value = this.#entries[(this.#start + offset) % this.#capacity];
      if (value !== undefined) visit(value);
    }
  }
}
