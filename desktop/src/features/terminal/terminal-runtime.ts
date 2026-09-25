import { ProjectTerminalClient } from "../../platform/tauri/project-terminal-client.js";
import type { TerminalControlEvent, TerminalMetadata, TerminalScope } from "../../protocol/project-terminal.js";
import { createTerminalEmulator, type TerminalEmulator, type EmulatorCallbacks } from "./terminal-emulator.js";
import { TerminalInput } from "./terminal-input.js";
import { TerminalStream } from "./terminal-stream.js";
import { terminalStore, type TerminalStore } from "./terminal-store.js";
import { applyTerminalSnapshot, removeTerminalMetadata, upsertTerminal } from "./terminal-sessions.js";

type Client = Pick<ProjectTerminalClient, "connect" | "create" | "write" | "ack" | "resize" | "close" | "remove">;
type RecordState = { emulator: TerminalEmulator; stream: TerminalStream; input: TerminalInput; metadata: TerminalMetadata; release: () => void; resize: [number, number] | undefined; resizing: boolean };
type ExitedEvent = Extract<TerminalControlEvent, { type: "exited" }>;

export class TerminalRuntime {
  private readonly client: Client;
  private readonly store: TerminalStore;
  private readonly factory: (callbacks: EmulatorCallbacks) => Promise<TerminalEmulator>;
  private readonly records = new Map<string, RecordState>();
  private readonly creating = new Map<string, Promise<void>>();
  private readonly earlyExits = new Map<string, ExitedEvent>();
  private readonly earlyRemoved = new Set<string>();
  private connecting: Promise<void> | undefined;
  private releaseControl: (() => void) | undefined;
  private generation: string | undefined;
  private visibleId: string | undefined;
  private visibleHost: HTMLElement | undefined;
  private disposed = false;

  constructor(options: { client?: Client; store?: TerminalStore; factory?: (callbacks: EmulatorCallbacks) => Promise<TerminalEmulator> } = {}) {
    this.client = options.client ?? new ProjectTerminalClient();
    this.store = options.store ?? terminalStore;
    this.factory = options.factory ?? createTerminalEmulator;
  }

  create(projectId: string, rootId: string): Promise<void> {
    const pending = this.creating.get(projectId);
    if (pending !== undefined) return pending;
    if (this.disposed) return Promise.reject(new Error("TERMINAL_OWNER_CLOSING"));
    const live = [...this.records.values()].filter(({ metadata }) => metadata.state === "running" || metadata.state === "closing");
    if (this.creating.size + live.length >= 12 || this.store.liveCount(projectId) >= 4) return Promise.reject(new Error("TERMINAL_LIMIT_REACHED"));
    const creation = this.createInner(projectId, rootId).finally(() => { this.creating.delete(projectId); this.store.update(projectId, { creating: false }); });
    this.creating.set(projectId, creation);
    return creation;
  }

  attach(terminalId: string, host: HTMLElement): void {
    if (this.visibleId !== undefined && this.visibleId !== terminalId) this.records.get(this.visibleId)?.emulator.detach();
    this.visibleId = terminalId;
    this.visibleHost = host;
    this.records.get(terminalId)?.emulator.attach(host);
    this.records.get(terminalId)?.emulator.focus();
  }
  detach(terminalId: string): void {
    this.records.get(terminalId)?.emulator.detach();
    if (this.visibleId === terminalId) { this.visibleId = undefined; this.visibleHost = undefined; }
  }
  focus(terminalId: string): void { this.records.get(terminalId)?.emulator.focus(); }
  async close(scope: TerminalScope): Promise<void> {
    const record = this.records.get(scope.terminalId);
    if (record?.metadata.generation === scope.generation) this.stopRecord(record);
    await this.client.close(scope);
    // native 返回成功即确认进程已回收；控制通道断开时也必须清除残留计数。
    const current = this.records.get(scope.terminalId);
    if (current?.metadata.generation !== scope.generation) return;
    this.disposeRecord(current);
    this.records.delete(scope.terminalId);
    removeTerminalMetadata(this.store, scope);
    await this.client.remove(scope);
  }
  async remove(scope: TerminalScope): Promise<void> { await this.client.remove(scope); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseControl?.();
    for (const record of this.records.values()) {
      this.disposeRecord(record);
      void this.client.close(record.metadata).catch(() => undefined);
    }
    this.records.clear(); this.earlyExits.clear(); this.earlyRemoved.clear();
  }

  private async connect(): Promise<void> {
    if (this.connecting !== undefined) return this.connecting;
    this.connecting = this.client.connect((snapshot) => {
      if (this.disposed) return;
      for (const record of this.records.values()) this.disposeRecord(record);
      this.records.clear();
      this.generation = snapshot.generation;
      applyTerminalSnapshot(this.store, snapshot);
    }, (event) => this.event(event), (error) => this.connectionFailed(error)).then((release) => { if (this.disposed) release(); else this.releaseControl = release; });
    try { await this.connecting; } catch (error) { this.connecting = undefined; throw error; }
  }

  private async createInner(projectId: string, rootId: string): Promise<void> {
    this.store.update(projectId, { creating: true, error: null });
    await this.connect();
    if (this.disposed) throw new Error("TERMINAL_OWNER_CLOSING");
    this.store.update(projectId, { creating: true });
    const generation = this.generation;
    if (generation === undefined) throw new Error("TERMINAL_SCOPE_MISMATCH");
    let scope: TerminalMetadata | undefined;
    let resolveScope: (value: TerminalMetadata | undefined) => void = () => undefined;
    const ready = new Promise<TerminalMetadata | undefined>((resolve) => { resolveScope = resolve; });
    let input: TerminalInput | undefined;
    let record: RecordState | undefined;
    let failed = false;
    const fail = (error: Error) => {
      this.store.update(projectId, { error: error.message });
      if (error.message !== "TERMINAL_INPUT_TOO_LARGE") {
        failed = true;
        input?.dispose(); record?.emulator.setExited();
        if (scope !== undefined) void this.client.close(scope).catch(() => undefined);
      }
    };
    const emulator = await this.factory({ data: (text) => input?.send(text), binary: (text) => input?.sendBinary(text), resize: (cols, rows) => { if (record !== undefined) { record.resize = [cols, rows]; void this.flushResize(record); } } });
    if (this.disposed) { emulator.dispose(); throw new Error("TERMINAL_OWNER_CLOSING"); }
    input = new TerminalInput(async (sequence, bytes) => { const target = await ready; if (target !== undefined) await this.client.write(target, sequence, bytes); }, fail);
    const stream = new TerminalStream({ write: (bytes, parsed) => emulator.write(bytes, parsed), ack: async (offset) => { const target = await ready; if (target !== undefined) await this.client.ack(target, offset); }, fail });
    try {
      const created = await this.client.create({ projectId, rootId, generation, requestId: crypto.randomUUID(), cols: 80, rows: 24 }, (buffer) => stream.accept(buffer));
      scope = created.metadata;
      resolveScope(scope);
      record = { emulator, stream, input, metadata: scope, release: created.dispose, resizing: false, resize: undefined };
      const removed = this.earlyRemoved.delete(scope.terminalId);
      if (this.disposed || removed) {
        this.earlyExits.delete(scope.terminalId);
        this.disposeRecord(record);
        // native 创建不可撤回；晚到的成功响应必须显式关闭，不能只销毁前端对象。
        if (this.disposed && !removed) await this.client.close(scope).catch((error: unknown) => this.store.update(projectId, { error: error instanceof Error ? error.message : "TERMINAL_CLEANUP_FAILED" }));
        return;
      }
      this.records.set(scope.terminalId, record);
      if (failed) { input.dispose(); emulator.setExited(); void this.client.close(scope).catch(() => undefined); }
      if (this.visibleId === scope.terminalId && this.visibleHost !== undefined) { emulator.attach(this.visibleHost); emulator.focus(); }
      const current = this.store.get(projectId).terminals.find((terminal) => terminal.terminalId === created.metadata.terminalId && terminal.generation === created.metadata.generation);
      upsertTerminal(this.store, current ?? scope);
      record.metadata = current ?? scope;
      this.store.update(projectId, { selectedId: scope.terminalId });
      const exited = this.earlyExits.get(scope.terminalId);
      if (exited !== undefined) { this.earlyExits.delete(scope.terminalId); this.event(exited); }
    } catch (error) {
      resolveScope(undefined); stream.dispose(); input.dispose(); emulator.dispose();
      throw error;
    }
  }

  private event(event: TerminalControlEvent): void {
    if (this.disposed) return;
    const metadata = event.data;
    if (metadata.generation !== this.generation) return;
    const record = this.records.get(metadata.terminalId);
    if (event.type === "removed") {
      this.earlyExits.delete(metadata.terminalId);
      if (record !== undefined) { this.disposeRecord(record); this.records.delete(metadata.terminalId); }
      else if (this.creating.has(metadata.projectId) && this.earlyRemoved.size < 24) this.earlyRemoved.add(metadata.terminalId);
      removeTerminalMetadata(this.store, metadata);
      return;
    }
    if (event.type === "exited") {
      if (record === undefined) {
        if (this.creating.has(metadata.projectId)) {
          if (this.earlyExits.size >= 24) throw new Error("TERMINAL_LIMIT_REACHED");
          this.earlyExits.set(metadata.terminalId, event);
        }
      }
      else {
        // 退出即释放输入、输出订阅与渲染资源，不等待尾帧，也不保留待删除的 tab。
        this.disposeRecord(record);
        this.records.delete(metadata.terminalId);
        removeTerminalMetadata(this.store, metadata);
        void this.client.remove(metadata).catch((error: unknown) => this.store.update(metadata.projectId, { error: error instanceof Error ? error.message : "TERMINAL_CLEANUP_FAILED" }));
      }
      return;
    }
    // 关闭响应可能先于排队中的状态事件到达，迟到事件不能重新创建已移除的会话。
    if (record === undefined && !this.creating.has(metadata.projectId)) return;
    if (record !== undefined && event.data.state === "closing") this.stopRecord(record);
    upsertTerminal(this.store, event.data);
    if (record !== undefined) record.metadata = event.data;
  }

  private async flushResize(record: RecordState): Promise<void> {
    if (record.resizing) return;
    record.resizing = true;
    try {
      while (record.resize !== undefined) {
        const [cols, rows] = record.resize; record.resize = undefined;
        await this.client.resize(record.metadata, cols, rows);
      }
    } catch (error) { this.store.update(record.metadata.projectId, { error: error instanceof Error ? error.message : "TERMINAL_STREAM_INVALID" }); }
    finally { record.resizing = false; }
  }

  private stopRecord(record: RecordState): void {
    // 进入关闭阶段即停止输入和 ACK，避免回收期间的在途操作再次触发关闭。
    record.stream.dispose(); record.input.dispose(); record.emulator.setExited();
  }
  private disposeRecord(record: RecordState): void { record.stream.dispose(); record.input.dispose(); record.release(); record.emulator.dispose(); }
  private connectionFailed(error: Error): void {
    this.connecting = undefined;
    for (const record of this.records.values()) {
      record.stream.dispose(); record.input.dispose(); record.emulator.setExited();
      this.store.update(record.metadata.projectId, { error: error.message });
      void this.client.close(record.metadata).catch(() => undefined);
    }
  }
}

export const terminalRuntime = new TerminalRuntime();

if (import.meta.env.VITE_WEBVIEW_TEST === "1") {
  (window as unknown as { __CODEAGENT_TERMINAL_TEST__: unknown }).__CODEAGENT_TERMINAL_TEST__ = {
    create: (projectId: string, rootId: string) => terminalRuntime.create(projectId, rootId),
    scopes: () => [...terminalStore.projectIds()].flatMap((id) => terminalStore.get(id).terminals),
    close: (scope: TerminalScope) => terminalRuntime.close(scope),
    remove: (scope: TerminalScope) => terminalRuntime.remove(scope),
  };
}
