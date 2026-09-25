import { Channel } from "@tauri-apps/api/core";
import { Value } from "@sinclair/typebox/value";
import { invoke, type NativeInvoke } from "./native-invoke.js";
import {
  TerminalControlEventSchema, TerminalMetadataSchema, TerminalSnapshotSchema, TERMINAL_LIMITS,
  parseTerminalOffset, terminalInputHeaders,
  type CreateTerminalRequest, type TerminalControlEvent, type TerminalMetadata, type TerminalScope, type TerminalSnapshot,
} from "../../protocol/project-terminal.js";

function releaseChannel(channel: Channel<unknown>): void {
  channel.onmessage = () => undefined;
  // Tauri 2.11 的公开 Channel 没有 dispose；失败创建也必须释放已注册的 JS callback。
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { unregisterCallback: (id: number) => void } }).__TAURI_INTERNALS__;
  internals?.unregisterCallback(channel.id);
}

export class ProjectTerminalClient {
  private readonly call: NativeInvoke;
  constructor(call: NativeInvoke = invoke) { this.call = call; }

  async connect(snapshot: (value: TerminalSnapshot) => void, event: (value: TerminalControlEvent) => void, fail: (error: Error) => void): Promise<() => void> {
    const channel = new Channel<unknown>();
    const pending: TerminalControlEvent[] = [];
    let ready = false;
    let failed: Error | undefined;
    let sequence = 0n;
    let generation: string | undefined;
    const deliver = (value: TerminalControlEvent) => {
      if (value.data.generation !== generation) throw new Error("TERMINAL_SCOPE_MISMATCH");
      const next = parseTerminalOffset(value.sequence);
      if (next <= sequence) return;
      if (next !== sequence + 1n) throw new Error("TERMINAL_STREAM_INVALID");
      sequence = next;
      event(value);
    };
    channel.onmessage = (value) => {
      try {
        if (!Value.Check(TerminalControlEventSchema, value)) throw new Error("TERMINAL_STREAM_INVALID");
        if (value.type === "exited") parseTerminalOffset(value.data.finalOffset);
        if (ready) deliver(value);
        else if (pending.length < 128) pending.push(value);
        else throw new Error("TERMINAL_STREAM_INVALID");
      } catch (error) {
        failed = this.error(error);
        pending.length = 0;
        releaseChannel(channel);
        fail(failed);
      }
    };
    try {
      const result = await this.call<unknown>("connect_project_terminals", { onEvent: channel });
      // 等待 invoke 时控制事件也可能先到；失败的连接不能被迟到快照重新激活。
      if (failed !== undefined) throw failed;
      if (!Value.Check(TerminalSnapshotSchema, result)) throw new Error("TERMINAL_STREAM_INVALID");
      if (result.terminals.some((terminal) => terminal.generation !== result.generation)) throw new Error("TERMINAL_SCOPE_MISMATCH");
      generation = result.generation;
      sequence = parseTerminalOffset(result.sequence);
      snapshot(result);
      ready = true;
      for (const value of pending) deliver(value);
      pending.length = 0;
      return () => releaseChannel(channel);
    } catch (error) { releaseChannel(channel); throw this.error(error); }
  }

  async create(request: CreateTerminalRequest, output: (buffer: ArrayBuffer) => void): Promise<{ metadata: TerminalMetadata; dispose: () => void }> {
    const channel = new Channel<unknown>();
    channel.onmessage = (value) => output(value as ArrayBuffer);
    try {
      const metadata = await this.call<unknown>("create_project_terminal", { ...request, onOutput: channel });
      if (!Value.Check(TerminalMetadataSchema, metadata)) throw new Error("TERMINAL_STREAM_INVALID");
      if (metadata.projectId !== request.projectId || metadata.rootId !== request.rootId || metadata.generation !== request.generation) {
        throw new Error("TERMINAL_SCOPE_MISMATCH");
      }
      return { metadata, dispose: () => releaseChannel(channel) };
    } catch (error) { releaseChannel(channel); throw this.error(error); }
  }

  async write(scope: TerminalScope, sequence: bigint, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength === 0 || bytes.byteLength > TERMINAL_LIMITS.blockBytes) throw new Error("TERMINAL_INPUT_TOO_LARGE");
    try { await this.call("write_project_terminal", bytes, { headers: terminalInputHeaders(scope, sequence) }); }
    catch (error) { throw this.error(error); }
  }

  async ack(scope: TerminalScope, parsedOffset: string): Promise<void> {
    parseTerminalOffset(parsedOffset);
    await this.command("ack_project_terminal", { ...scope, parsedOffset });
  }
  async resize(scope: TerminalScope, cols: number, rows: number): Promise<void> { await this.command("resize_project_terminal", { ...scope, cols, rows }); }
  async close(scope: TerminalScope): Promise<void> { await this.command("close_project_terminal", { ...scope }); }
  async remove(scope: TerminalScope): Promise<void> { await this.command("remove_project_terminal", { ...scope }); }

  private async command(command: string, args: Record<string, unknown>): Promise<void> {
    try { await this.call(command, args); } catch (error) { throw this.error(error); }
  }
  private error(value: unknown): Error {
    if (value instanceof Error) return value;
    if (value !== null && typeof value === "object" && "code" in value && typeof value.code === "string") {
      return Object.assign(new Error("message" in value && typeof value.message === "string" ? value.message : value.code), { code: value.code });
    }
    return new Error(typeof value === "string" ? value : "TERMINAL_STREAM_INVALID");
  }
}
