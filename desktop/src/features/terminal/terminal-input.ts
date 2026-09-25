import { TERMINAL_LIMITS } from "../../protocol/project-terminal.js";

type InputChunk = { bytes: Uint8Array; startsPaste: boolean; endsPaste: boolean; interrupt: boolean };

export class TerminalInput {
  private readonly encoder = new TextEncoder();
  private queue: InputChunk[] = [];
  private bracketedActive = false;
  private bytes = 0;
  private sequence = 0n;
  private sending = false;
  private disposed = false;
  private epoch = 0;
  private cancelDelay: (() => void) | undefined;
  private readonly write: (sequence: bigint, bytes: Uint8Array) => Promise<void>;
  private readonly fail: (error: Error) => void;

  constructor(
    write: (sequence: bigint, bytes: Uint8Array) => Promise<void>,
    fail: (error: Error) => void,
  ) { this.write = write; this.fail = fail; }

  get queuedBytes(): number { return this.bytes; }

  send(text: string): void {
    if (this.disposed || text.length === 0) return;
    const bracketed = text.startsWith("\x1b[200~") && text.endsWith("\x1b[201~");
    const overhead = bracketed ? 12 : 0;
    if (text.length - overhead > TERMINAL_LIMITS.pasteBytes) {
      this.fail(new Error("TERMINAL_INPUT_TOO_LARGE"));
      return;
    }
    const interrupt = text === "\x03";
    const bytes = this.encoder.encode(interrupt ? "\x1b[201~\x03" : text);
    this.enqueue(bytes, bracketed, interrupt);
  }

  sendBinary(text: string): void {
    if (this.disposed || text.length === 0) return;
    if (text.length > TERMINAL_LIMITS.pasteBytes) { this.fail(new Error("TERMINAL_INPUT_TOO_LARGE")); return; }
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    this.enqueue(bytes, false, false);
  }

  private enqueue(bytes: Uint8Array, bracketed: boolean, interrupt: boolean): void {
    const overhead = bracketed ? 12 : 0;
    // 已交给 native 的分块不能撤回；Ctrl+C 只丢弃尚未发送的数据，随后保持序号连续。
    if (interrupt) {
      this.epoch += 1;
      this.cancelDelay?.();
      for (const queued of this.queue) this.bytes -= queued.bytes.byteLength;
      this.queue = [];
    }
    const chunks = Math.ceil(bytes.byteLength / TERMINAL_LIMITS.blockBytes);
    if (bytes.byteLength - overhead > TERMINAL_LIMITS.pasteBytes || this.bytes + bytes.byteLength > TERMINAL_LIMITS.pasteBytes + 12 || this.queue.length + chunks > 256) {
      this.fail(new Error("TERMINAL_INPUT_TOO_LARGE"));
      return;
    }
    this.bytes += bytes.byteLength;
    for (let offset = 0; offset < bytes.byteLength; offset += TERMINAL_LIMITS.blockBytes) {
      this.queue.push({ bytes: bytes.subarray(offset, offset + TERMINAL_LIMITS.blockBytes), startsPaste: bracketed && offset === 0, endsPaste: bracketed && offset + TERMINAL_LIMITS.blockBytes >= bytes.byteLength, interrupt });
    }
    if (!this.sending) void this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelDelay?.();
    this.queue = [];
    this.bytes = 0;
  }

  private async flush(): Promise<void> {
    this.sending = true;
    try {
      while (!this.disposed) {
        const chunk = this.queue.shift();
        if (chunk === undefined) break;
        // 等前一块的接受结果确定后，再决定是否补 paste 结束标记；不能猜测在途块的状态。
        const bytes = chunk.interrupt && !this.bracketedActive ? chunk.bytes.subarray(6) : chunk.bytes;
        const epoch = this.epoch;
        for (let attempt = 0; ; attempt += 1) {
          try {
            await this.write(this.sequence + 1n, bytes);
            this.sequence += 1n;
            if (chunk.startsPaste) this.bracketedActive = true;
            if (chunk.endsPaste || chunk.interrupt) this.bracketedActive = false;
            break;
          } catch (error) {
            const full = error !== null && typeof error === "object" && "code" in error && error.code === "TERMINAL_INPUT_QUEUE_FULL";
            if (!full || attempt >= 63) throw error;
            if (this.disposed || epoch !== this.epoch) break;
            // 仅队列明确拒绝时可重试；不重放可能已部分写入 OS 的数据。
            await this.waitForCapacity();
            if (this.disposed || epoch !== this.epoch) break;
          }
        }
        if (!this.disposed) this.bytes -= chunk.bytes.byteLength;
      }
    } catch (error) {
      // 关闭会话后，在途 IPC 的拒绝已不再代表有效输入失败。
      if (this.disposed) return;
      this.dispose();
      this.fail(error instanceof Error ? error : new Error("TERMINAL_STREAM_INVALID"));
    } finally { this.sending = false; }
  }

  private waitForCapacity(): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => { clearTimeout(timer); this.cancelDelay = undefined; resolve(); };
      const timer = setTimeout(finish, 8);
      this.cancelDelay = finish;
    });
  }
}
