import type { ChunkedText, TextChunk } from "../../../shared/lib/chunked-text.js";

const DEFAULT_MAX_BYTES = 1_048_576;
const DEFAULT_MAX_LINES = 10_000;
const MAX_CHUNK_BYTES = 16 * 1_024;
const MAX_CHUNK_LINES = 256;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface RetainedTextChunk extends TextChunk {
  byteLength: number;
  encodedValue: Uint8Array;
  mergeLevel: number;
  newlineCount: number;
}

export interface CommandOutputView extends ChunkedText {
  hasOutput: boolean;
  outputBytes: number;
  outputTruncated: boolean;
}

export class CommandOutputBuffer {
  readonly #materialize = () => this.materialize();
  readonly #maxBytes: number;
  readonly #maxLines: number;
  #chunks: RetainedTextChunk[] = [];
  #hasOutput = false;
  #headIndex = 0;
  #materializedOutput = "";
  #materializedVersion = -1;
  #newlineCount = 0;
  #nextChunkId = 1;
  #outputBytes = 0;
  #outputTruncated = false;
  #version = 0;

  public constructor(
    output: string | undefined,
    outputTruncated: boolean,
    options: Readonly<{ maxBytes?: number; maxLines?: number }> = {},
  ) {
    this.#maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.#maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
    this.replace(output, outputTruncated);
  }

  public append(delta: string): void {
    this.#hasOutput = true;
    const encodedDelta = textEncoder.encode(delta);
    this.#appendEncodedChunks(encodedDelta);
    this.#version += 1;
    this.#enforceLimits();
  }

  public getView(): CommandOutputView {
    return {
      chunks: this.#chunks,
      hasOutput: this.#hasOutput,
      materialize: this.#materialize,
      outputBytes: this.#outputBytes,
      outputTruncated: this.#outputTruncated,
      startIndex: this.#headIndex,
      version: this.#version,
    };
  }

  public materialize(): string {
    if (this.#materializedVersion === this.#version) {
      return this.#materializedOutput;
    }
    const retainedChunks = this.#chunks;
    const outputChunks: string[] = [];
    for (let index = this.#headIndex; index < retainedChunks.length; index += 1) {
      outputChunks.push(retainedChunks[index]?.text ?? "");
    }
    const output = outputChunks.join("");
    this.#materializedOutput = output;
    this.#materializedVersion = this.#version;
    return output;
  }

  public replace(output: string | undefined, outputTruncated: boolean): void {
    this.#chunks = [];
    this.#hasOutput = output !== undefined;
    this.#headIndex = 0;
    this.#newlineCount = 0;
    this.#outputBytes = 0;
    this.#outputTruncated = outputTruncated;
    this.#version += 1;
    if (output !== undefined && output.length > 0) {
      this.#appendEncodedChunks(textEncoder.encode(output));
      this.#enforceLimits();
    }
  }

  #appendEncodedChunks(encodedValue: Uint8Array): void {
    let startIndex = 0;
    while (startIndex < encodedValue.byteLength) {
      let endIndex = startIndex;
      let newlineCount = 0;
      while (endIndex < encodedValue.byteLength) {
        const leadingByte = encodedValue[endIndex] ?? 0;
        const codePointBytes = getUtf8CodePointLength(leadingByte);
        if (endIndex > startIndex && endIndex + codePointBytes - startIndex > MAX_CHUNK_BYTES) {
          break;
        }
        endIndex += codePointBytes;
        if (leadingByte === 10) {
          newlineCount += 1;
          if (newlineCount >= MAX_CHUNK_LINES) {
            break;
          }
        }
      }
      const encodedChunk = encodedValue.subarray(startIndex, endIndex);
      const chunk: RetainedTextChunk = {
        byteLength: encodedChunk.byteLength,
        encodedValue: encodedChunk.slice(),
        id: this.#nextChunkId,
        mergeLevel: 0,
        newlineCount,
        text: textDecoder.decode(encodedChunk),
      };
      this.#nextChunkId += 1;
      this.#chunks.push(chunk);
      this.#newlineCount += newlineCount;
      this.#outputBytes += chunk.byteLength;
      this.#mergeTailChunks();
      startIndex = endIndex;
    }
  }

  #mergeTailChunks(): void {
    while (this.#chunks.length - this.#headIndex >= 2) {
      const rightChunk = this.#chunks.at(-1);
      const leftChunk = this.#chunks.at(-2);
      if (
        rightChunk === undefined ||
        leftChunk?.mergeLevel !== rightChunk.mergeLevel ||
        leftChunk.byteLength + rightChunk.byteLength > MAX_CHUNK_BYTES ||
        leftChunk.newlineCount + rightChunk.newlineCount > MAX_CHUNK_LINES
      ) {
        return;
      }
      const encodedValue = new Uint8Array(leftChunk.byteLength + rightChunk.byteLength);
      encodedValue.set(leftChunk.encodedValue);
      encodedValue.set(rightChunk.encodedValue, leftChunk.byteLength);
      this.#chunks.splice(-2, 2, {
        byteLength: encodedValue.byteLength,
        encodedValue,
        id: this.#nextChunkId,
        mergeLevel: leftChunk.mergeLevel + 1,
        newlineCount: leftChunk.newlineCount + rightChunk.newlineCount,
        text: `${leftChunk.text}${rightChunk.text}`,
      });
      this.#nextChunkId += 1;
    }
  }

  #enforceLimits(): void {
    while (this.#outputBytes > this.#maxBytes || this.#newlineCount >= this.#maxLines) {
      const evictedChunk = this.#chunks[this.#headIndex];
      if (evictedChunk === undefined) {
        break;
      }
      this.#headIndex += 1;
      this.#outputBytes -= evictedChunk.byteLength;
      this.#newlineCount -= evictedChunk.newlineCount;
      this.#outputTruncated = true;
    }

    // 头部达到一半后批量压实，避免 Array.shift() 在流式热路径反复搬移。
    if (this.#headIndex >= 128 && this.#headIndex * 2 >= this.#chunks.length) {
      this.#chunks = this.#chunks.slice(this.#headIndex);
      this.#headIndex = 0;
    }
  }
}

function getUtf8CodePointLength(leadingByte: number): number {
  if ((leadingByte & 0x80) === 0) return 1;
  if ((leadingByte & 0xe0) === 0xc0) return 2;
  if ((leadingByte & 0xf0) === 0xe0) return 3;
  return 4;
}
