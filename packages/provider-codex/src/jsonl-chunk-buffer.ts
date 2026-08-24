import { StringDecoder } from "node:string_decoder";

export class JsonlChunkBuffer {
  readonly #chunks: Buffer[] = [];
  #byteLength = 0;

  public get byteLength(): number {
    return this.#byteLength;
  }

  public get lastByte(): number | undefined {
    return this.#chunks.at(-1)?.at(-1);
  }

  public append(chunk: Buffer): void {
    if (chunk.length === 0) return;
    // 复制尾部视图，避免为少量未完成数据长期持有整个 stdout burst。
    this.#chunks.push(Buffer.from(chunk));
    this.#byteLength += chunk.length;
  }

  public takeFrame(suffix: Buffer): Buffer {
    if (this.#byteLength === 0) return suffix;

    const frameBytes = this.#byteLength + suffix.length;
    if (suffix.length > 0) this.#chunks.push(suffix);
    // 所有历史碎片只在帧完成时合并一次，组帧复制量保持 O(n)。
    const frame = Buffer.concat(this.#chunks, frameBytes);
    this.clear();
    return frame;
  }

  public hasNonWhitespace(): boolean {
    const decoder = new StringDecoder("utf8");
    for (const chunk of this.#chunks) {
      if (decoder.write(chunk).trim().length > 0) return true;
    }
    return decoder.end().trim().length > 0;
  }

  public clear(): void {
    this.#chunks.length = 0;
    this.#byteLength = 0;
  }
}
