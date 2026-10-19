import { write } from "node:fs";
import { Writable } from "node:stream";

/** Bun 的 Windows stdout 同步写会阻塞事件循环，异步 fd 写入保留背压和退出截止时间。 */
export function createHostOutputStream(fd: number): Writable {
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      let offset = 0;
      const next = () => {
        write(fd, chunk, offset, chunk.length - offset, null, (error, bytes) => {
          // Linux nonblocking pipes report temporary backpressure as EAGAIN.
          if (error?.code === "EAGAIN" || error?.code === "EWOULDBLOCK") {
            setTimeout(next, 5);
            return;
          }
          if (error) {
            callback(error);
            return;
          }
          if (!bytes) {
            callback(new Error("Claude host stdout write made no progress"));
            return;
          }
          offset += bytes;
          if (offset < chunk.length) next();
          else callback();
        });
      };
      next();
    },
  });
}

export const HOST_OUTPUT_BUDGET = 8 * 1024 * 1024;
interface Frame {
  text: string;
  bytes: number;
  key: string | undefined;
  message: Record<string, unknown> | undefined;
}

/** stdout 的唯一写入者；同步事件监听器只入队，传输故障不得抛回 SDK 消费器。 */
export class HostOutput {
  readonly #queue: Frame[] = [];
  #bytes = 0;
  #blocked = false;
  #closed = false;
  #scheduled = false;
  #timer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly output: Writable,
    readonly onFailure: (reason: string) => void,
    readonly budget = HOST_OUTPUT_BUDGET,
    readonly stallTimeout = 45_000,
  ) {
    output.on("drain", () => {
      this.#blocked = false;
      clearTimeout(this.#timer);
      this.#flush();
    });
    output.on("error", () => {
      this.#fail("stdout write failed");
    });
    output.on("close", () => {
      this.#fail("stdout closed");
    });
  }

  get bufferedBytes() {
    return this.#bytes + this.output.writableLength;
  }

  send(message: Record<string, unknown>): boolean {
    if (this.#closed) return false;
    try {
      const text = `${JSON.stringify(message)}\n`,
        bytes = Buffer.byteLength(text);
      if (
        bytes > this.budget ||
        this.bufferedBytes + bytes > this.budget ||
        this.#queue.length >= 4096
      ) {
        this.#fail("stdout queue budget exceeded");
        return false;
      }
      const event = message["event"] as Record<string, unknown> | undefined;
      const payload = event?.["payload"] as Record<string, unknown> | undefined;
      // 只合并相邻、同一正文块的纯文本增量；审批、终态和快照响应都是顺序屏障。
      const key =
        event &&
        payload &&
        Object.keys(payload).every((key) => key === "delta" || key === "field") &&
        typeof payload["delta"] === "string" &&
        ["message.delta", "reasoning.delta"].includes(String(event["type"]))
          ? JSON.stringify([
              message["projectId"],
              event["type"],
              event["taskId"],
              event["turnId"],
              event["itemId"],
              payload["field"],
            ])
          : undefined;
      const tail = this.#queue.at(-1);
      if (key && tail?.key === key && tail.message && tail.bytes + bytes < 64 * 1024) {
        const previousEvent = tail.message["event"] as Record<string, unknown>;
        const previousPayload = previousEvent["payload"] as Record<string, unknown>;
        const merged = {
          ...message,
          event: {
            ...event,
            payload: {
              ...payload,
              delta: String(previousPayload["delta"]) + String(payload?.["delta"]),
            },
          },
        };
        const mergedText = `${JSON.stringify(merged)}\n`;
        this.#bytes -= tail.bytes;
        Object.assign(tail, {
          message: merged,
          text: mergedText,
          bytes: Buffer.byteLength(mergedText),
        });
        this.#bytes += tail.bytes;
      } else {
        this.#queue.push({ text, bytes, key, message: key ? message : undefined });
        this.#bytes += bytes;
      }
      if (!this.#scheduled) {
        this.#scheduled = true;
        queueMicrotask(() => {
          this.#scheduled = false;
          this.#flush();
        });
      }
      return true;
    } catch {
      this.#fail("stdout frame encoding failed");
      return false;
    }
  }

  close() {
    this.#closed = true;
    this.#queue.length = 0;
    this.#bytes = 0;
    clearTimeout(this.#timer);
  }

  #fail(reason: string) {
    if (this.#closed) return;
    this.close();
    // 关闭运行时可能发布最终事件；延后清理以避免重入当前 SDK 事件调用栈。
    queueMicrotask(() => {
      this.onFailure(reason);
    });
  }

  #flush() {
    if (this.#closed || this.#blocked) return;
    try {
      let frame: Frame | undefined;
      while ((frame = this.#queue.shift())) {
        this.#bytes -= frame.bytes;
        if (!this.output.write(frame.text)) {
          this.#blocked = true;
          this.#timer = setTimeout(() => {
            this.#fail("stdout drain timed out");
          }, this.stallTimeout);
          this.#timer.unref();
          break;
        }
      }
    } catch {
      this.#fail("stdout write failed");
    }
  }
}
