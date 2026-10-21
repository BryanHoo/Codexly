import { expect, it, vi } from "vitest";
import { bindTaskRuntime } from "./task-runtime-binding.js";

it("在慢快照返回前接回事件，并合并同时发生的恢复读取", async () => {
  const pending = Promise.withResolvers<{ revision: number }>();
  const read = vi.fn((_signal: AbortSignal) => pending.promise);
  const release = vi.fn();
  let recover!: () => Promise<{ revision: number }>;
  const resume = vi.fn((reader: typeof recover) => {
    recover = reader;
    return release;
  });
  const attach = vi.fn(() => vi.fn());
  const reconcile = vi.fn();
  const onSnapshot = vi.fn();
  const onError = vi.fn();
  const dispose = bindTaskRuntime({ read, resume, attach, reconcile, onSnapshot, onError });

  expect(resume).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
  expect(attach).not.toHaveBeenCalled();
  const recovery = recover();
  expect(read).toHaveBeenCalledOnce();
  pending.resolve({ revision: 1 });
  await recovery;
  expect(reconcile).toHaveBeenCalledWith({ revision: 1 });
  expect(onSnapshot).toHaveBeenCalledWith({ revision: 1 });
  expect(onError).not.toHaveBeenCalled();
  dispose();
  dispose();
  expect(release).toHaveBeenCalledOnce();
  expect(read.mock.calls[0]?.[0].aborted).toBe(true);
});

it.each(["resolve", "reject"] as const)("切走后撤销请求并忽略迟到快照（%s）", async (outcome) => {
  const pending = Promise.withResolvers<number>();
  const release = vi.fn();
  const attach = vi.fn(() => vi.fn());
  const reconcile = vi.fn();
  const onSnapshot = vi.fn();
  const onError = vi.fn();
  const dispose = bindTaskRuntime({
    read: () => pending.promise,
    resume: () => release,
    attach,
    reconcile,
    onSnapshot,
    onError,
  });
  dispose();
  if (outcome === "resolve") pending.resolve(1);
  else pending.reject(new Error("已取消"));
  await pending.promise.catch(() => undefined);
  await Promise.resolve();
  expect(attach).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
  expect(onSnapshot).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it("后台校准失败仍保留实时订阅，并允许后续恢复重新读取", async () => {
  const failure = new Error("快照暂时不可用");
  const read = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(2);
  const release = vi.fn();
  const onError = vi.fn();
  let recover!: () => Promise<number>;
  const dispose = bindTaskRuntime<number>({
    read,
    resume: (reader) => {
      recover = reader;
      return release;
    },
    attach: vi.fn(() => vi.fn()),
    reconcile: vi.fn(),
    onSnapshot: vi.fn(),
    onError,
  });
  await vi.waitFor(() => {
    expect(onError).toHaveBeenCalledWith(failure);
  });
  expect(release).not.toHaveBeenCalled();
  await expect(recover()).resolves.toBe(2);
  expect(read).toHaveBeenCalledTimes(2);
  dispose();
});

it("首次打开等待快照后订阅，预热快照不重复请求", async () => {
  const read = vi.fn(() => Promise.resolve(2));
  const release = vi.fn();
  const attach = vi.fn(() => release);
  const reconcile = vi.fn();
  const onSnapshot = vi.fn();
  const dispose = bindTaskRuntime({
    cachedResponse: 1,
    read,
    resume: () => undefined,
    attach,
    reconcile,
    onSnapshot,
    onError: vi.fn(),
  });
  expect(attach).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(attach).toHaveBeenCalledWith(1, expect.any(Function));
  expect(read).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
  expect(onSnapshot).toHaveBeenCalledWith(1);
  dispose();
  expect(release).toHaveBeenCalledOnce();
});
