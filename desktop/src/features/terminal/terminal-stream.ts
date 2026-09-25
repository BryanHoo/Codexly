import { decodeTerminalFrame, parseTerminalOffset, TERMINAL_LIMITS } from "../../protocol/project-terminal.js";

type StreamCallbacks = {
  write: (bytes: Uint8Array, parsed: () => void) => void;
  ack: (offset: string) => Promise<void>;
  fail: (error: Error) => void;
};

export class TerminalStream {
  private sequence = 0n;
  private received = 0n;
  private parsed = 0n;
  private acknowledged = 0n;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ackPending = false;
  private disposed = false;
  private finalOffset: bigint | undefined;
  private end: { offset: bigint; complete: () => void } | undefined;

  private readonly callbacks: StreamCallbacks;
  constructor(callbacks: StreamCallbacks) { this.callbacks = callbacks; }

  accept(buffer: ArrayBuffer): void {
    if (this.disposed) return;
    try {
      const frame = decodeTerminalFrame(buffer);
      const start = this.received;
      if (frame.sequence !== this.sequence + 1n || frame.endOffset !== start + BigInt(frame.bytes.byteLength)
        || frame.endOffset - this.parsed > BigInt(TERMINAL_LIMITS.outputHighBytes + TERMINAL_LIMITS.blockBytes)
        || (this.finalOffset !== undefined && frame.endOffset > this.finalOffset)) {
        throw new Error("TERMINAL_STREAM_INVALID");
      }
      this.sequence = frame.sequence;
      this.received = frame.endOffset;
      // 输出直接进入 xterm；仅完成回调推进解析偏移，不经过 React 或元数据 Store。
      this.callbacks.write(frame.bytes, () => {
        if (this.disposed) return;
        if (this.parsed !== start) { this.fail(new Error("TERMINAL_STREAM_INVALID")); return; }
        this.parsed = frame.endOffset;
        this.scheduleAck();
        this.completeIfDrained();
      });
    } catch (error) { this.fail(error instanceof Error ? error : new Error("TERMINAL_STREAM_INVALID")); }
  }

  finish(finalOffset: string, complete: () => void): void {
    if (this.disposed) return;
    try {
      const offset = parseTerminalOffset(finalOffset);
      if (offset < this.received || this.finalOffset !== undefined) throw new Error("TERMINAL_STREAM_INVALID");
      // 完成退出回调后仍保留最终边界，拒绝迟到的额外输出或重复退出。
      this.finalOffset = offset;
      this.end = { offset, complete };
      this.completeIfDrained();
    } catch (error) { this.fail(error instanceof Error ? error : new Error("TERMINAL_STREAM_INVALID")); }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.end = undefined;
  }

  private completeIfDrained(): void {
    if (this.end !== undefined && this.parsed === this.end.offset) {
      const complete = this.end.complete;
      this.end = undefined;
      complete();
    }
  }

  private scheduleAck(): void {
    if (this.disposed || this.parsed === this.acknowledged || this.ackPending) return;
    if (this.parsed - this.acknowledged >= BigInt(TERMINAL_LIMITS.ackBytes)) {
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      void this.flushAck();
    } else if (this.timer === undefined) {
      // 单次尾部计时器确保不足 32 KiB 的数据也会确认；空闲时不保留计时器。
      this.timer = setTimeout(() => { this.timer = undefined; void this.flushAck(); }, TERMINAL_LIMITS.ackDelayMs);
    }
  }

  private async flushAck(): Promise<void> {
    if (this.disposed || this.ackPending || this.parsed === this.acknowledged) return;
    this.ackPending = true;
    const offset = this.parsed;
    try {
      await this.callbacks.ack(offset.toString());
      this.acknowledged = offset;
    } catch (error) { this.fail(error instanceof Error ? error : new Error("TERMINAL_STREAM_INVALID")); }
    finally { this.ackPending = false; this.scheduleAck(); }
  }

  private fail(error: Error): void {
    if (this.disposed) return;
    this.dispose();
    this.callbacks.fail(error);
  }
}
