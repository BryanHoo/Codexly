import { describe, expect, it, vi } from "vitest";

import { createAsyncActionLock } from "./async-action-lock.js";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("createAsyncActionLock", () => {
  it("同步忽略前一次操作完成前的重复调用", async () => {
    const deferred = createDeferred<string>();
    const action = vi.fn(() => deferred.promise);
    const lock = createAsyncActionLock();

    const first = lock.run(action);
    const duplicate = lock.run(action);

    expect(action).toHaveBeenCalledOnce();
    await expect(duplicate).resolves.toBeUndefined();

    deferred.resolve("done");
    await expect(first).resolves.toBe("done");
  });

  it("操作成功后允许再次执行", async () => {
    const action = vi.fn(() => Promise.resolve("done"));
    const lock = createAsyncActionLock();

    await expect(lock.run(action)).resolves.toBe("done");
    await expect(lock.run(action)).resolves.toBe("done");

    expect(action).toHaveBeenCalledTimes(2);
  });

  it("操作失败后释放锁并保留原错误", async () => {
    const error = new Error("failed");
    const action = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce("retried");
    const lock = createAsyncActionLock();

    await expect(lock.run(action)).rejects.toBe(error);
    await expect(lock.run(action)).resolves.toBe("retried");
  });
});
