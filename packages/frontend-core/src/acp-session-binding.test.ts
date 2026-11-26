import { expect, it, vi } from "vitest";
import type { AcpConfigOption, AcpSessionState } from "@codexly/protocol";
import { bindAcpSessionState, type AcpSessionSource } from "./acp-session-binding.js";

const initial: AcpSessionState = {
  configOptions: [{ id: "mode", name: "模式", type: "boolean", currentValue: false }],
  availableCommands: [{ name: "review", description: "检查" }],
};

it("发送与配置写入同步互斥，不能等 React 更新后才禁用", async () => {
  const f = fixture(initial),
    pending = deferred<readonly AcpConfigOption[]>(),
    sent = deferred<string>();
  const write = vi.fn(() => pending.promise),
    execute = vi.fn(() => sent.promise);
  const binding = bindAcpSessionState({
    ...f,
    projectId: "p",
    taskId: "t",
    read: vi.fn(),
    write,
    onChange: vi.fn(),
  });
  const saving = binding.setConfig("mode", true);
  await expect(binding.runConfigured(execute)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
  pending.resolve(initial.configOptions);
  await saving;
  const sending = binding.runConfigured(execute);
  expect(await binding.setConfig("mode", false)).toBe(false);
  sent.resolve("accepted");
  expect(await sending).toBe("accepted");
  binding.dispose();
  await expect(binding.runConfigured(execute)).rejects.toThrow();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(session?: AcpSessionState) {
  let state = {
    projectId: "p",
    taskId: "t",
    snapshotMetadata: session ? { acpSession: session } : null,
  };
  const listeners = new Set<() => void>();
  const source: AcpSessionSource = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const emit = (next?: AcpSessionState) => {
    state = { ...state, snapshotMetadata: next ? { acpSession: next } : null };
    for (const listener of listeners) listener();
  };
  return { source, emit, listeners };
}

it("快照直接承担展示，正文通知不重绘，也不重复读取 ACP", () => {
  const f = fixture(initial),
    read = vi.fn(),
    changed = vi.fn();
  const binding = bindAcpSessionState({
    ...f,
    projectId: "p",
    taskId: "t",
    read,
    write: vi.fn(),
    onChange: changed,
  });
  expect(binding.getSnapshot().session).toEqual(initial);
  const count = changed.mock.calls.length;
  f.emit(initial);
  expect(changed).toHaveBeenCalledTimes(count);
  expect(read).not.toHaveBeenCalled();
  binding.dispose();
  expect(f.listeners.size).toBe(0);
});

it("完整事件优先于迟到读取，销毁后中止传输且不能写回", async () => {
  const f = fixture(),
    pending = deferred<AcpSessionState>();
  let signal!: AbortSignal;
  const binding = bindAcpSessionState({
    source: f.source,
    projectId: "p",
    taskId: "t",
    read: (input) => {
      signal = input;
      return pending.promise;
    },
    write: vi.fn(),
    onChange: vi.fn(),
  });
  expect(binding.getSnapshot().isPending).toBe(true);
  f.emit(initial);
  expect(binding.getSnapshot().isPending).toBe(false);
  pending.resolve({ configOptions: [], availableCommands: [] });
  await pending.promise;
  expect(binding.getSnapshot().session).toEqual(initial);
  binding.dispose();
  expect(signal.aborted).toBe(true);
  f.emit({ configOptions: [], availableCommands: [] });
  expect(binding.getSnapshot().session).toEqual(initial);
});

it("配置写入同步互斥，完整替换响应并保留命令，失败可重试", async () => {
  const f = fixture(initial),
    pending = deferred<readonly AcpConfigOption[]>();
  const write = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([]);
  const binding = bindAcpSessionState({
    source: f.source,
    projectId: "p",
    taskId: "t",
    read: vi.fn(),
    write,
    onChange: vi.fn(),
  });
  const saving = binding.setConfig("mode", true);
  expect(binding.getSnapshot().isSaving).toBe(true);
  expect(await binding.setConfig("mode", true)).toBe(false);
  pending.resolve([]);
  expect(await saving).toBe(true);
  expect(binding.getSnapshot().session).toEqual({
    configOptions: [],
    availableCommands: initial.availableCommands,
  });
  expect(await binding.setConfig("mode", false)).toBe(false);
  expect(binding.getSnapshot().error?.message).toBe("offline");
  expect(await binding.setConfig("mode", false)).toBe(true);
  expect(binding.getSnapshot().error).toBe(null);
  expect(write).toHaveBeenCalledTimes(3);
  binding.dispose();
});

it("跨任务 Store 不得污染会话，旧写入不能回滚更新事件", async () => {
  const f = fixture(initial),
    read = deferred<AcpSessionState>(),
    write = deferred<readonly AcpConfigOption[]>();
  const foreign = bindAcpSessionState({
    source: f.source,
    projectId: "p",
    taskId: "other",
    read: () => read.promise,
    write: vi.fn(),
    onChange: vi.fn(),
  });
  expect(foreign.getSnapshot().session).toBeUndefined();
  foreign.dispose();
  const binding = bindAcpSessionState({
    source: f.source,
    projectId: "p",
    taskId: "t",
    read: vi.fn(),
    write: () => write.promise,
    onChange: vi.fn(),
  });
  const saving = binding.setConfig("mode", true);
  const updated = { configOptions: [], availableCommands: [] };
  f.emit(updated);
  write.resolve(initial.configOptions);
  expect(await saving).toBe(true);
  expect(binding.getSnapshot().session).toEqual(updated);
  const snapshot = binding.getSnapshot();
  binding.dispose();
  expect(await binding.setConfig("mode", true)).toBe(false);
  expect(binding.getSnapshot()).toBe(snapshot);
});
