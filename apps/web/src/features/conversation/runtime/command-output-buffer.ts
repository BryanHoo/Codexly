import type { AgentCommandOutputOmission } from "@codexly/protocol";

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
  outputLines: number;
  outputOmitted: AgentCommandOutputOmission;
}

export class CommandOutputBuffer {
  readonly #headByteLimit: number;
  readonly #headNewlineLimit: number;
  readonly #materialize = () => this.materialize();
  readonly #tailByteLimit: number;
  readonly #tailNewlineLimit: number;
  #headBytes = 0;
  #headChunks: RetainedTextChunk[] = [];
  #headClosed = false;
  #headNewlines = 0;
  #hasOutput = false;
  #materializedOutput = "";
  #materializedVersion = -1;
  #nextChunkId = 1;
  #outputOmitted: AgentCommandOutputOmission = { bytes: 0, lines: 0 };
  #tailBytes = 0;
  #tailChunks: RetainedTextChunk[] = [];
  #tailHeadIndex = 0;
  #tailNewlines = 0;
  #version = 0;
  #viewChunks: readonly RetainedTextChunk[] = [];
  #viewChunksVersion = -1;

  public constructor(
    output: string | undefined,
    outputOmitted: AgentCommandOutputOmission,
    options: Readonly<{ maxBytes?: number; maxLines?: number }> = {},
  ) {
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES);
    const headLines = Math.ceil(maxLines / 2);
    const tailLines = maxLines - headLines;
    this.#headByteLimit = Math.ceil(maxBytes / 2);
    this.#tailByteLimit = maxBytes - this.#headByteLimit;
    this.#headNewlineLimit = headLines;
    this.#tailNewlineLimit = Math.max(0, tailLines - 1);
    this.replace(output, outputOmitted);
  }

  public append(delta: string): void {
    this.#hasOutput = true;
    this.#appendEncoded(textEncoder.encode(delta));
    this.#version += 1;
  }

  public getView(): CommandOutputView {
    return {
      chunks: this.#readChunks(),
      hasOutput: this.#hasOutput,
      materialize: this.#materialize,
      outputBytes: this.#headBytes + this.#tailBytes,
      outputLines: this.#headNewlines + this.#tailNewlines,
      outputOmitted: this.#outputOmitted,
      startIndex: 0,
      version: this.#version,
    };
  }

  public materialize(): string {
    if (this.#materializedVersion === this.#version) return this.#materializedOutput;
    const output = this.#readChunks()
      .map((chunk) => chunk.text)
      .join("");
    this.#materializedOutput = output;
    this.#materializedVersion = this.#version;
    return output;
  }

  public replace(output: string | undefined, outputOmitted: AgentCommandOutputOmission): void {
    this.#headBytes = 0;
    this.#headChunks = [];
    this.#headClosed = false;
    this.#headNewlines = 0;
    this.#hasOutput = output !== undefined;
    this.#outputOmitted = outputOmitted;
    this.#tailBytes = 0;
    this.#tailChunks = [];
    this.#tailHeadIndex = 0;
    this.#tailNewlines = 0;
    if (output !== undefined && output.length > 0) this.#appendEncoded(textEncoder.encode(output));
    this.#version += 1;
  }

  #appendEncoded(encodedValue: Uint8Array): void {
    let tailStart = 0;
    if (!this.#headClosed) {
      const headLength = findPrefixLength(
        encodedValue,
        this.#headByteLimit - this.#headBytes,
        this.#headNewlineLimit - this.#headNewlines,
      );
      if (headLength > 0) {
        const appended = this.#appendEncodedChunks(
          this.#headChunks,
          encodedValue.subarray(0, headLength),
        );
        this.#headBytes += appended.bytes;
        this.#headNewlines += appended.newlines;
      }
      tailStart = headLength;
      this.#headClosed = headLength < encodedValue.byteLength;
    }

    if (tailStart < encodedValue.byteLength) {
      const appended = this.#appendEncodedChunks(
        this.#tailChunks,
        encodedValue.subarray(tailStart),
        this.#tailHeadIndex,
      );
      this.#tailBytes += appended.bytes;
      this.#tailNewlines += appended.newlines;
      this.#enforceTailLimits();
    }
  }

  #appendEncodedChunks(
    chunks: RetainedTextChunk[],
    encodedValue: Uint8Array,
    activeStartIndex = 0,
  ): Readonly<{ bytes: number; newlines: number }> {
    let startIndex = 0;
    let totalNewlines = 0;
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
          if (newlineCount >= MAX_CHUNK_LINES) break;
        }
      }
      const encodedChunk = encodedValue.subarray(startIndex, endIndex).slice();
      chunks.push(this.#createChunk(encodedChunk, newlineCount));
      totalNewlines += newlineCount;
      this.#mergeTailChunks(chunks, activeStartIndex);
      startIndex = endIndex;
    }
    return { bytes: encodedValue.byteLength, newlines: totalNewlines };
  }

  #createChunk(encodedValue: Uint8Array, newlineCount: number, mergeLevel = 0): RetainedTextChunk {
    const chunk = {
      byteLength: encodedValue.byteLength,
      encodedValue,
      id: this.#nextChunkId,
      mergeLevel,
      newlineCount,
      text: textDecoder.decode(encodedValue),
    };
    this.#nextChunkId += 1;
    return chunk;
  }

  #mergeTailChunks(chunks: RetainedTextChunk[], activeStartIndex: number): void {
    while (chunks.length - activeStartIndex >= 2) {
      const rightChunk = chunks.at(-1);
      const leftChunk = chunks.at(-2);
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
      chunks.splice(
        -2,
        2,
        this.#createChunk(
          encodedValue,
          leftChunk.newlineCount + rightChunk.newlineCount,
          leftChunk.mergeLevel + 1,
        ),
      );
    }
  }

  #enforceTailLimits(): void {
    while (this.#tailBytes > this.#tailByteLimit || this.#tailNewlines > this.#tailNewlineLimit) {
      const chunk = this.#tailChunks[this.#tailHeadIndex];
      if (chunk === undefined) break;
      const cut = findEvictionLength(
        chunk.encodedValue,
        this.#tailBytes - this.#tailByteLimit,
        this.#tailNewlines - this.#tailNewlineLimit,
      );
      this.#tailBytes -= cut.bytes;
      this.#tailNewlines -= cut.newlines;
      this.#outputOmitted = {
        bytes: this.#outputOmitted.bytes + cut.bytes,
        lines: this.#outputOmitted.lines + cut.newlines,
      };
      if (cut.bytes === chunk.byteLength) {
        this.#tailHeadIndex += 1;
      } else {
        const retained = chunk.encodedValue.subarray(cut.bytes).slice();
        this.#tailChunks[this.#tailHeadIndex] = this.#createChunk(
          retained,
          chunk.newlineCount - cut.newlines,
        );
      }
    }

    // 批量压实已淘汰前缀，避免流式热路径反复 Array.shift()。
    if (this.#tailHeadIndex >= 128 && this.#tailHeadIndex * 2 >= this.#tailChunks.length) {
      this.#tailChunks = this.#tailChunks.slice(this.#tailHeadIndex);
      this.#tailHeadIndex = 0;
    }
  }

  #readChunks(): readonly RetainedTextChunk[] {
    if (this.#viewChunksVersion !== this.#version) {
      this.#viewChunks = [...this.#headChunks, ...this.#tailChunks.slice(this.#tailHeadIndex)];
      this.#viewChunksVersion = this.#version;
    }
    return this.#viewChunks;
  }
}

function findPrefixLength(encodedValue: Uint8Array, maxBytes: number, maxNewlines: number): number {
  let index = 0;
  let newlines = 0;
  while (index < encodedValue.byteLength) {
    if (newlines >= maxNewlines) break;
    const leadingByte = encodedValue[index] ?? 0;
    const codePointBytes = getUtf8CodePointLength(leadingByte);
    if (index + codePointBytes > maxBytes) break;
    if (leadingByte === 10 && newlines >= maxNewlines) break;
    index += codePointBytes;
    if (leadingByte === 10) newlines += 1;
  }
  return index;
}

function findEvictionLength(
  encodedValue: Uint8Array,
  minimumBytes: number,
  minimumNewlines: number,
): Readonly<{ bytes: number; newlines: number }> {
  let bytes = 0;
  let newlines = 0;
  while (bytes < encodedValue.byteLength && (bytes < minimumBytes || newlines < minimumNewlines)) {
    const leadingByte = encodedValue[bytes] ?? 0;
    bytes += getUtf8CodePointLength(leadingByte);
    if (leadingByte === 10) newlines += 1;
  }
  return { bytes, newlines };
}

function getUtf8CodePointLength(leadingByte: number): number {
  if ((leadingByte & 0x80) === 0) return 1;
  if ((leadingByte & 0xe0) === 0xc0) return 2;
  if ((leadingByte & 0xf0) === 0xe0) return 3;
  return 4;
}
