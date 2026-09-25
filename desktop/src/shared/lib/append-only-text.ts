export interface TextSnapshot {
  readonly chunks: readonly string[];
  readonly chunkCount: number;
}

export class AppendOnlyTextBuffer {
  private readonly chunks: string[];
  private cachedText: string;
  private materializedCount = 1;
  private snapshot: TextSnapshot;

  constructor(initialText: string) {
    this.chunks = [initialText];
    this.cachedText = initialText;
    this.snapshot = { chunks: this.chunks, chunkCount: 1 };
  }

  append(delta: string): void {
    this.chunks.push(delta);
    // 共享只追加数组，但固定快照边界，旧渲染不能读到后续追加的数据。
    this.snapshot = { chunks: this.chunks, chunkCount: this.chunks.length };
  }

  getSnapshot(): TextSnapshot {
    return this.snapshot;
  }

  materialize(): string {
    // 只连接尚未读取的 Chunk，保留引擎的字符串拼接结构，避免 join 复制历史正文。
    while (this.materializedCount < this.chunks.length) {
      this.cachedText += this.chunks[this.materializedCount]!;
      this.materializedCount += 1;
    }
    return this.cachedText;
  }
}
