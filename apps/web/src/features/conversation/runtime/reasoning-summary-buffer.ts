import { AppendOnlyTextBuffer, type TextSnapshot } from "@codexly/frontend-core/append-only-text";

export class ReasoningSummaryBuffer {
  private buffer: AppendOnlyTextBuffer;
  private changed = false;
  private initialSummary: string | undefined;

  constructor(initialSummary: string | undefined) {
    this.initialSummary = initialSummary;
    this.buffer = new AppendOnlyTextBuffer(initialSummary ?? "");
  }

  get hasChanges(): boolean {
    return this.changed;
  }

  append(delta: string): void {
    this.buffer.append(delta);
    this.changed = true;
  }

  read(): string | undefined {
    if (this.initialSummary === undefined) {
      return undefined;
    }
    return this.buffer.materialize();
  }

  getSnapshot(): TextSnapshot | undefined {
    return this.initialSummary === undefined ? undefined : this.buffer.getSnapshot();
  }

  replace(initialSummary: string | undefined): void {
    this.buffer = new AppendOnlyTextBuffer(initialSummary ?? "");
    this.changed = false;
    this.initialSummary = initialSummary;
  }
}
