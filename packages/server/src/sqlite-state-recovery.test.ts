import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SqliteStateRepository } from "./sqlite-state-repository.js";

interface WorkerPlan {
  startupError?: Error;
  startupPending?: boolean;
  startupFatalCode?: string;
  unresponsive?: boolean;
}

const harness = vi.hoisted(() => ({
  plans: [] as WorkerPlan[],
  workers: [] as {
    emit: (event: string, ...args: unknown[]) => boolean;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Worker: class extends EventEmitter {
      #exited = false;
      readonly postMessage;
      readonly terminate = vi.fn(async () => {
        await Promise.resolve();
        if (!this.#exited) {
          this.#exited = true;
          this.emit("exit", 1);
        }
        return 1;
      });

      constructor() {
        super();
        const plan = harness.plans.shift() ?? {};
        harness.workers.push(this);
        this.postMessage = vi.fn((message: { id: number; operation: string }) => {
          // 响应放进微任务，保留真实 Worker 消息与调用栈之间的异步边界。
          void Promise.resolve().then(() => {
            if (message.operation === "close") {
              this.emit("message", { id: message.id, result: null, type: "response" });
              this.#exited = true;
              this.emit("exit", 0);
            } else if (!plan.unresponsive) {
              this.emit("message", { id: message.id, result: [], type: "response" });
            }
          });
        });
        void Promise.resolve().then(() => {
          if (plan.startupFatalCode) {
            this.emit("message", {
              type: "fatal",
              error: {
                code: plan.startupFatalCode,
                message: "database is damaged",
                name: "SqliteError",
              },
            });
          } else if (plan.startupError) {
            this.emit("error", plan.startupError);
          } else if (!plan.startupPending) {
            this.emit("message", { type: "ready" });
          }
        });
      }
    },
  };
});

describe("SQLite worker recovery", () => {
  let repository: SqliteStateRepository | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    harness.plans.length = 0;
    harness.workers.length = 0;
  });

  afterEach(async () => {
    // 失败的断言也必须释放 Worker，避免清理错误覆盖真正的回归信号。
    await repository?.close().catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    repository = undefined;
  });

  async function open(plans: WorkerPlan[]): Promise<SqliteStateRepository> {
    harness.plans.push(...plans);
    repository = await SqliteStateRepository.open(fileURLToPath(import.meta.url), {
      requestTimeoutMs: 1_000,
    });
    return repository;
  }

  it("retries after a failed replacement and shares recovery between concurrent callers", async () => {
    const repo = await open([
      { unresponsive: true },
      { startupError: new Error("temporary startup failure") },
      {},
    ]);
    const timeout = expect(repo.list()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await timeout;
    await expect(repo.list()).rejects.toThrow("temporary startup failure");

    // 退避窗口内快速返回最近错误；到期后并发调用只建立一个新连接。
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(
      Promise.all([repo.list(), repo.list(), repo.listQueue("project", "task")]),
    ).resolves.toEqual([[], [], []]);
    expect(harness.workers).toHaveLength(3);
  });

  it("rejects all in-flight operations on timeout without replaying an uncertain write", async () => {
    const repo = await open([{ unresponsive: true }, {}]);
    const results = Promise.allSettled([
      repo.deleteProject("project"),
      repo.list(),
      repo.readGlobalSettings(),
    ]);
    await vi.advanceTimersByTimeAsync(1_000);
    for (const result of await results) {
      expect(result.status).toBe("rejected");
      expect(result).toHaveProperty("reason.message", expect.stringMatching(/timed out/u));
    }
    await expect(repo.list()).resolves.toEqual([]);
    expect(harness.workers).toHaveLength(2);
    expect(harness.workers[0]?.postMessage).toHaveBeenCalledTimes(3);
    expect(harness.workers[1]?.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.workers[1]?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "listProjects" }),
    );
    expect(harness.workers[0]?.terminate).toHaveBeenCalledTimes(1);
  });

  it("bounds exponential backoff and does not retry without new requests", async () => {
    const failure = new Error("database temporarily unavailable");
    const repo = await open([
      { unresponsive: true },
      ...Array<WorkerPlan>(8).fill({ startupError: failure }),
      {},
    ]);
    const timeout = expect(repo.list()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await timeout;

    for (const [index, delay] of [100, 200, 400, 800, 1_600, 3_200, 5_000].entries()) {
      await expect(repo.list()).rejects.toBe(failure);
      await vi.advanceTimersByTimeAsync(delay - 1);
      await expect(repo.list()).rejects.toBe(failure);
      expect(harness.workers).toHaveLength(index + 2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(Promise.all([repo.list(), repo.list()])).rejects.toBe(failure);
      expect(harness.workers).toHaveLength(index + 3);
    }
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.workers).toHaveLength(9);
    await expect(repo.list()).resolves.toEqual([]);
    expect(harness.workers).toHaveLength(10);
  });

  it.each(["error", "exit"])("recovers after a worker %s event", async (event) => {
    const repo = await open([{ unresponsive: true }, {}]);
    const pending = repo.list();
    const rejected = expect(pending).rejects.toThrow(
      event === "error" ? "worker crashed" : /exited/u,
    );
    await vi.advanceTimersByTimeAsync(0);
    harness.workers[0]?.emit(event, event === "error" ? new Error("worker crashed") : 1);
    await rejected;
    await expect(Promise.all([repo.list(), repo.list()])).resolves.toEqual([[], []]);
    expect(harness.workers).toHaveLength(2);
  });

  it("shares a failed initialization between waiters and recovers after its timeout", async () => {
    const repo = await open([{ unresponsive: true }, { startupPending: true }, {}]);
    const timeout = expect(repo.list()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await timeout;
    const results = Promise.allSettled([repo.list(), repo.list()]);
    await vi.advanceTimersByTimeAsync(1_000);
    for (const result of await results) {
      expect(result.status).toBe("rejected");
      expect(result).toHaveProperty(
        "reason.message",
        expect.stringMatching(/initialization timed out/u),
      );
    }
    await vi.advanceTimersByTimeAsync(100);
    await expect(repo.list()).resolves.toEqual([]);
    expect(harness.workers).toHaveLength(3);
  });

  it("ignores late messages from a replaced worker", async () => {
    const repo = await open([{ unresponsive: true }, { unresponsive: true }]);
    const timeout = expect(repo.list()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await timeout;
    const read = repo.list();
    await vi.advanceTimersByTimeAsync(0);
    const message = harness.workers[1]?.postMessage.mock.calls[0]?.[0] as { id: number };
    // 旧代即使发送与新请求相同的 ID 或 fatal，也不能污染新连接。
    harness.workers[0]?.emit("message", { type: "response", id: message.id, result: ["stale"] });
    harness.workers[0]?.emit("message", {
      type: "fatal",
      error: { message: "stale failure", name: "Error" },
    });
    harness.workers[1]?.emit("message", { type: "response", id: message.id, result: [] });
    await expect(read).resolves.toEqual([]);
    expect(harness.workers[1]?.terminate).not.toHaveBeenCalled();
  });

  it("keeps ordinary operation failures local but stops on corruption responses", async () => {
    const repo = await open([{ unresponsive: true }]);
    const ordinary = expect(repo.list()).rejects.toThrow("invalid operation");
    await vi.advanceTimersByTimeAsync(0);
    const worker = harness.workers[0];
    const firstMessage = worker?.postMessage.mock.calls[0]?.[0] as { id: number };
    worker?.emit("message", {
      type: "response",
      id: firstMessage.id,
      error: { message: "invalid operation", name: "Error" },
    });
    await ordinary;
    expect(worker?.terminate).not.toHaveBeenCalled();

    const results = Promise.allSettled([repo.list(), repo.listQueue("project", "task")]);
    await vi.advanceTimersByTimeAsync(0);
    const secondMessage = worker?.postMessage.mock.calls[1]?.[0] as { id: number };
    worker?.emit("message", {
      type: "response",
      id: secondMessage.id,
      error: { code: "SQLITE_CORRUPT", message: "database is damaged", name: "SqliteError" },
    });
    for (const result of await results) {
      expect(result.status).toBe("rejected");
      expect(result).toHaveProperty("reason.code", "SQLITE_CORRUPT");
    }
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(repo.list()).rejects.toMatchObject({ code: "SQLITE_CORRUPT" });
    expect(harness.workers).toHaveLength(1);
  });

  it.each(["SQLITE_CORRUPT", "SQLITE_CORRUPT_INDEX", "SQLITE_NOTADB"])(
    "preserves %s across the worker boundary and stops automatic recovery",
    async (code) => {
      const repo = await open([{ unresponsive: true }, { startupFatalCode: code }, {}]);
      const timeout = expect(repo.list()).rejects.toThrow(/timed out/u);
      await vi.advanceTimersByTimeAsync(1_000);
      await timeout;
      await expect(repo.list()).rejects.toMatchObject({ code, name: "SqliteError" });
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(repo.list()).rejects.toMatchObject({ code });
      expect(harness.workers).toHaveLength(2);
      expect(harness.workers[1]?.terminate).toHaveBeenCalledTimes(1);
      await expect(repo.close()).resolves.toBeUndefined();
    },
  );

  it("closes during recovery and rejects concurrent waiters without starting another worker", async () => {
    const repo = await open([{ unresponsive: true }, { startupPending: true }, {}]);
    const timeout = expect(repo.list()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await timeout;
    const waiters = Promise.allSettled([repo.list(), repo.list()]);
    const firstClose = repo.close();
    expect(repo.close()).toBe(firstClose);
    await firstClose;
    expect((await waiters).every((result) => result.status === "rejected")).toBe(true);
    await expect(repo.list()).rejects.toThrow(/closed/u);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.workers).toHaveLength(2);
    expect(harness.workers[1]?.terminate).toHaveBeenCalledTimes(1);
  });

  it("closes cleanly after a failed replacement without rethrowing its startup error", async () => {
    const repo = await open([
      { unresponsive: true },
      { startupError: new Error("temporary startup failure") },
    ]);
    const timeout = expect(repo.list()).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1_000);
    await timeout;
    await expect(repo.close()).resolves.toBeUndefined();
    await expect(repo.list()).rejects.toThrow(/closed/u);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.workers).toHaveLength(2);
  });

  it("does not send a request if close starts while the request is waiting for readiness", async () => {
    const repo = await open([{}]);
    const read = expect(repo.list()).rejects.toThrow(/closed/u);
    const close = repo.close();
    await Promise.all([read, close]);
    expect(harness.workers[0]?.postMessage).toHaveBeenCalledTimes(1);
    expect(harness.workers[0]?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "close" }),
    );
  });
});
