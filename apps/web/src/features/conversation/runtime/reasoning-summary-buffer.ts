export class ReasoningSummaryBuffer {
  private chunks: string[] = [];
  private initialSummary: string | undefined;
  private materializedSummary: string | undefined;

  constructor(initialSummary: string | undefined) {
    this.initialSummary = initialSummary;
    this.materializedSummary = initialSummary;
  }

  get hasChanges(): boolean {
    return this.chunks.length > 0;
  }

  append(delta: string): void {
    this.chunks.push(delta);
    this.materializedSummary = undefined;
  }

  read(): string | undefined {
    if (this.initialSummary === undefined) {
      return undefined;
    }
    this.materializedSummary ??= [this.initialSummary, ...this.chunks].join("");
    return this.materializedSummary;
  }

  replace(initialSummary: string | undefined): void {
    this.chunks = [];
    this.initialSummary = initialSummary;
    this.materializedSummary = initialSummary;
  }
}
