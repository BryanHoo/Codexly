type SequencedEvent = Readonly<{ sequence: number }>;

type Entry<Event> = Readonly<{ event: Event; retainedBytes: number }>;

export class ProjectEventHistory<Event extends SequencedEvent> {
  #count = 0;
  readonly #entries: (Entry<Event> | undefined)[];
  readonly #estimateBytes: (event: Event) => number;
  #floorSequence = 0;
  readonly #maxBytes: number;
  readonly #maxEvents: number;
  #retainedBytes = 0;
  #start = 0;

  public constructor(
    options: Readonly<{
      estimateBytes: (event: Event) => number;
      maxBytes: number;
      maxEvents: number;
    }>,
  ) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) {
      throw new RangeError("Project Event history maxBytes must be non-negative");
    }
    if (!Number.isSafeInteger(options.maxEvents) || options.maxEvents < 0) {
      throw new RangeError("Project Event history maxEvents must be non-negative");
    }
    this.#estimateBytes = options.estimateBytes;
    this.#maxBytes = options.maxBytes;
    this.#maxEvents = options.maxEvents;
    this.#entries = new Array<Entry<Event> | undefined>(options.maxEvents);
  }

  public get floorSequence(): number {
    return this.#floorSequence;
  }

  public append(event: Event): void {
    const retainedBytes = this.#estimateBytes(event);
    if (retainedBytes > this.#maxBytes || this.#maxEvents === 0) {
      this.reset(event.sequence);
      return;
    }
    if (this.#count === this.#maxEvents) this.#evictOldest();
    this.#entries[(this.#start + this.#count) % this.#maxEvents] = { event, retainedBytes };
    this.#count += 1;
    this.#retainedBytes += retainedBytes;
    while (this.#retainedBytes > this.#maxBytes) this.#evictOldest();
  }

  public forEachAfter(sequence: number, visit: (event: Event) => void): void {
    for (let offset = 0; offset < this.#count; offset += 1) {
      const entry = this.#entries[(this.#start + offset) % this.#maxEvents];
      if (entry !== undefined && entry.event.sequence > sequence) visit(entry.event);
    }
  }

  public reset(floorSequence = this.#floorSequence): void {
    this.#entries.fill(undefined);
    this.#count = 0;
    this.#floorSequence = floorSequence;
    this.#retainedBytes = 0;
    this.#start = 0;
  }

  #evictOldest(): void {
    const entry = this.#entries[this.#start];
    if (entry === undefined) return;
    this.#entries[this.#start] = undefined;
    this.#start = (this.#start + 1) % this.#maxEvents;
    this.#count -= 1;
    this.#retainedBytes -= entry.retainedBytes;
    this.#floorSequence = entry.event.sequence;
  }
}

export function isDeltaEvent(event: Readonly<{ type: string }>): boolean {
  return (
    event.type === "message.delta" ||
    event.type === "plan.delta" ||
    event.type === "reasoning.delta" ||
    event.type === "command.output_delta"
  );
}
