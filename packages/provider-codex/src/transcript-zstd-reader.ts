import { createReadStream } from "node:fs";
import { pipeline } from "node:stream";
import { constants, createZstdDecompress } from "node:zlib";

const MAX_READERS = 2;
const IDLE_TIMEOUT_MS = 30_000;
const readers = new Set<TranscriptZstdReader>();

/** 保留解压游标，避免大文件每次读取都重新解压前缀；空闲时释放文件句柄与解码窗口。 */
export class TranscriptZstdReader {
  readonly #source;
  readonly #decoder;
  readonly #iterator;
  #pending: Buffer = Buffer.alloc(0);
  #timer: NodeJS.Timeout | undefined;
  closed = false;
  done = false;

  private constructor(path: string) {
    this.#source = createReadStream(path, { highWaterMark: 64 * 1024 });
    this.#decoder = createZstdDecompress({
      chunkSize: 64 * 1024,
      // 上游 level 3 的窗口小于此限制；拒绝异常大窗口，避免压缩文件放大内存占用。
      params: { [constants.ZSTD_d_windowLogMax]: 23 },
    });
    this.#iterator = this.#decoder[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    pipeline(this.#source, this.#decoder, () => {
      // 错误由迭代器交付读取方；pipeline 同时负责关闭两端流。
    });
    readers.add(this);
  }

  static open(path: string): TranscriptZstdReader | undefined {
    // 不排队、不抢占正在使用的游标；饱和时跳过可选的 Skill 补充读取。
    if (readers.size >= MAX_READERS) return undefined;
    return new TranscriptZstdReader(path);
  }

  async read(limit: number, consume: (chunk: Buffer) => void): Promise<number> {
    clearTimeout(this.#timer);
    let count = 0;
    try {
      while (count < limit && !this.closed) {
        if (this.#pending.length === 0) {
          const next = await this.#iterator.next();
          if (next.done) {
            this.done = true;
            this.close();
            break;
          }
          this.#pending = next.value;
        }
        const length = Math.min(limit - count, this.#pending.length);
        consume(this.#pending.subarray(0, length));
        this.#pending = this.#pending.subarray(length);
        count += length;
      }
      return count;
    } catch (error) {
      this.close();
      throw error;
    } finally {
      if (!this.closed)
        this.#timer = setTimeout(() => {
          this.close();
        }, IDLE_TIMEOUT_MS).unref();
    }
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.#timer);
    this.#pending = Buffer.alloc(0);
    this.#source.destroy();
    this.#decoder.destroy();
    readers.delete(this);
  }
}
