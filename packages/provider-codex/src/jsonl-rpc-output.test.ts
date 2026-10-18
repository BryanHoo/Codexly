import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { JsonlRpcClient, type JsonlRpcClientOptions } from "./jsonl-rpc-client.js";

function methods(frames: string[]) {
  return frames.map((frame) => (JSON.parse(frame) as { method?: string }).method);
}

function createBlockedClient(options: Partial<JsonlRpcClientOptions> = {}) {
  const frames: string[] = [];
  const callbacks: (() => void)[] = [];
  const output = new Writable({
    highWaterMark: 1024,
    write(chunk: Buffer, _encoding, callback) {
      frames.push(chunk.toString("utf8"));
      callbacks.push(callback);
    },
  });
  const input = new PassThrough();
  const client = new JsonlRpcClient({ input, output, ...options });
  return { callbacks, client, frames, input, output };
}

describe("Codex RPC 全局出站调度", () => {
  it("阻塞 1 KiB 写端时拒绝超额并发，且只向 Writable 交付首帧", async () => {
    const { client, output } = createBlockedClient();
    const results = Array.from({ length: 256 }, () =>
      client.request("load", "x".repeat(64 * 1024)).catch((error: unknown) => error),
    );
    try {
      await setImmediate();
      expect(output.writableLength).toBe(
        Buffer.byteLength(
          `${JSON.stringify({ id: 1, method: "load", params: "x".repeat(64 * 1024) })}\n`,
        ),
      );
      client.close();
      const errors = await Promise.all(results);
      expect(
        errors.filter((error) => error instanceof Error && error.name === "RpcWriteQueueFullError")
          .length,
      ).toBe(128);
    } finally {
      client.close();
      await Promise.all(results);
    }
  });

  it("字节预算包含 UTF-8、换行、排队帧和正在交付的帧，并在取消后归还预算", async () => {
    const { client, callbacks, frames, input, output } = createBlockedClient({
      maxWriteBufferBytes: 1600,
    });
    const first = client.request("first", "中".repeat(400)).catch((error: unknown) => error);
    const controller = new AbortController();
    const queued = client
      .request("queued", "x".repeat(200), 1000, controller.signal)
      .catch((error: unknown) => error);
    try {
      await expect(client.request("rejected", "x".repeat(200))).rejects.toMatchObject({
        name: "RpcWriteQueueFullError",
      });
      expect(client.closed).toBe(false);
      expect(output.writableLength).toBeGreaterThan(1200);
      controller.abort();
      expect(await queued).toMatchObject({ name: "AbortError" });
      const replacement = client
        .request("replacement", "x".repeat(200))
        .catch((error: unknown) => error);
      callbacks.shift()?.();
      await setImmediate();
      expect(methods(frames)).toEqual(["first", "replacement"]);
      callbacks.shift()?.();
      input.write('{"id":1,"result":"ok"}\n');
      input.write('{"id":4,"result":"ok"}\n');
      expect(await first).toBe("ok");
      expect(await replacement).toBe("ok");
    } finally {
      client.close();
      await first;
    }
  });

  it("写回调完成后仍须等待 drain，并对通知和服务端响应保持 FIFO", async () => {
    const { client, callbacks, frames, output } = createBlockedClient();
    // 模拟底层已完成写回调、但尚未通知恢复写入的两个独立边界。
    const emit = output.emit.bind(output);
    vi.spyOn(output, "emit").mockImplementation((event, ...args: unknown[]) =>
      event === "drain" ? true : emit(event, ...args),
    );
    const first = client.request("first", "x".repeat(2048)).catch((error: unknown) => error);
    client.notify("initialized");
    const response = client
      .respondToServerRequest("approval", { decision: "accept" })
      .catch((error: unknown) => error);
    try {
      callbacks.shift()?.();
      await setImmediate();
      expect(frames).toHaveLength(1);
      emit("drain");
      await setImmediate();
      callbacks.shift()?.();
      await setImmediate();
      callbacks.shift()?.();
      await response;
      expect(frames.map((frame) => JSON.parse(frame) as unknown)).toEqual([
        { id: 1, method: "first", params: "x".repeat(2048) },
        { method: "initialized" },
        { id: "approval", result: { decision: "accept" } },
      ]);
    } finally {
      client.close();
      await first;
    }
  });

  it("排队超时不再写入，也不会重置其他请求的响应截止时间", async () => {
    vi.useFakeTimers();
    const { client, callbacks, frames, input } = createBlockedClient({ defaultTimeoutMs: 1000 });
    const first = client.request("first", "x".repeat(2048)).catch((error: unknown) => error);
    const expired = client.request("expired", {}, 20).catch((error: unknown) => error);
    const live = client.request("live", {}, 100).catch((error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(60);
      expect(await expired).toMatchObject({ name: "RpcTimeoutError", timeoutMs: 20 });
      callbacks.shift()?.();
      await setImmediate();
      expect(methods(frames)).toEqual(["first", "live"]);
      callbacks.shift()?.();
      await vi.advanceTimersByTimeAsync(40);
      expect(await live).toMatchObject({ name: "RpcTimeoutError", timeoutMs: 100 });
      input.write('{"id":3,"result":"late"}\n');
      expect(client.closed).toBe(false);
    } finally {
      client.close();
      await first;
      vi.useRealTimers();
    }
  });

  it("请求指定的较长截止时间也覆盖写入阶段", async () => {
    vi.useFakeTimers();
    const { client, callbacks, input } = createBlockedClient({ defaultTimeoutMs: 20 });
    const request = client
      .request("long-write", "x".repeat(2048), 100)
      .catch((error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(50);
      expect(client.closed).toBe(false);
      callbacks.shift()?.();
      await setImmediate();
      input.write('{"id":1,"result":"ok"}\n');
      expect(await request).toBe("ok");
    } finally {
      client.close();
      await request;
      vi.useRealTimers();
    }
  });

  it("写入已完成但响应未到时仍限制逻辑请求数，且拒绝前不序列化", async () => {
    const { client, callbacks, input } = createBlockedClient({ maxPendingRequests: 1 });
    const first = client.request("first").catch((error: unknown) => error);
    const toJSON = vi.fn(() => "payload");
    try {
      callbacks.shift()?.();
      await setImmediate();
      await expect(client.request("rejected", { toJSON })).rejects.toMatchObject({
        name: "RpcWriteQueueFullError",
      });
      expect(toJSON).not.toHaveBeenCalled();
      input.write('{"id":1,"result":"ok"}\n');
      expect(await first).toBe("ok");
      const next = client.request("next");
      callbacks.shift()?.();
      input.write('{"id":2,"result":"ok"}\n');
      expect(await next).toBe("ok");
    } finally {
      client.close();
      await first;
    }
  });

  it("服务端响应共享写入数量上限，关闭时清空队列与监听器", async () => {
    vi.useFakeTimers();
    const { client, callbacks, frames, output } = createBlockedClient({ maxPendingWrites: 2 });
    const first = client.request("first", "x".repeat(2048)).catch((error: unknown) => error);
    const response = client.respondToServerRequest("approval", {}).catch((error: unknown) => error);
    const toJSON = vi.fn(() => "payload");
    try {
      await expect(client.respondToServerRequest("excess", { toJSON })).rejects.toMatchObject({
        name: "RpcWriteQueueFullError",
      });
      expect(toJSON).not.toHaveBeenCalled();
      expect(client.closed).toBe(false);
      client.close();
      expect(await response).toMatchObject({ name: "RpcConnectionClosedError" });
      expect(await first).toMatchObject({ name: "RpcConnectionClosedError" });
      expect(vi.getTimerCount()).toBe(0);
      expect(output.listenerCount("drain")).toBe(0);
      callbacks.shift()?.();
      output.emit("drain");
      expect(frames).toHaveLength(1);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("取消已交付帧时保留其物理写入预算，回调完成后才归还", async () => {
    const controller = new AbortController();
    const frameBytes = Buffer.byteLength('{"id":1,"method":"first","params":"中"}\n');
    const { client, callbacks } = createBlockedClient({ maxWriteBufferBytes: frameBytes });
    const first = client
      .request("first", "中", 1000, controller.signal)
      .catch((error: unknown) => error);
    try {
      controller.abort();
      expect(await first).toMatchObject({ name: "AbortError" });
      await expect(client.request("other")).rejects.toMatchObject({
        name: "RpcWriteQueueFullError",
      });
      callbacks.shift()?.();
      await setImmediate();
      const response = client.respondToServerRequest("ok", null);
      callbacks.shift()?.();
      await expect(response).resolves.toBeUndefined();
    } finally {
      client.close();
      await first;
    }
  });

  it.each(["cancel", "deadline"] as const)("编码期间发生 %s 时不交付帧", async (event) => {
    vi.useFakeTimers();
    const { client, frames } = createBlockedClient();
    const controller = new AbortController();
    try {
      const request = client.request(
        "encode",
        {
          toJSON() {
            if (event === "cancel") controller.abort();
            else vi.setSystemTime(Date.now() + 200);
            return "payload";
          },
        },
        100,
        controller.signal,
      );
      await expect(request).rejects.toMatchObject({
        name: event === "cancel" ? "AbortError" : "RpcTimeoutError",
      });
      expect(frames).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(client.closed).toBe(false);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("重试排队后取消也不补写原请求", async () => {
    vi.useFakeTimers();
    const { client, callbacks, frames, input } = createBlockedClient({
      overloadRetry: { baseDelayMs: 10, random: () => 0.5 },
    });
    const controller = new AbortController();
    const request = client
      .request("retry", {}, 1000, controller.signal)
      .catch((error: unknown) => error);
    try {
      callbacks.shift()?.();
      await setImmediate();
      input.write('{"id":1,"error":{"code":-32001,"message":"busy","data":{"retry":true}}}\n');
      client.notify("blocking", "x".repeat(2048));
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      expect(await request).toMatchObject({ name: "AbortError" });
      callbacks.shift()?.();
      await setImmediate();
      expect(methods(frames)).toEqual(["retry", "blocking"]);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("已交付帧到截止时间仍未完成时关闭故障管道并释放所有计时器", async () => {
    vi.useFakeTimers();
    const { client, output } = createBlockedClient();
    const request = client
      .request("stalled", "x".repeat(2048), 20)
      .catch((error: unknown) => error);
    try {
      await vi.advanceTimersByTimeAsync(20);
      expect(await request).toMatchObject({ name: "RpcTimeoutError" });
      expect(client.closed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(output.listenerCount("drain")).toBe(0);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it.each(["close", "finish"])("写端 %s 时拒绝排队项", async (event) => {
    const { client, output } = createBlockedClient();
    const first = client.request("first", "x".repeat(2048)).catch((error: unknown) => error);
    const queued = client.respondToServerRequest("approval", {}).catch((error: unknown) => error);
    output.emit(event);
    expect(await first).toMatchObject({ name: "RpcConnectionClosedError" });
    expect(await queued).toMatchObject({ name: "RpcConnectionClosedError" });
    expect(client.closed).toBe(true);
  });

  it("事件循环尚未触发超时回调时也拒绝超过截止时间的响应", async () => {
    vi.useFakeTimers();
    const { client, callbacks, input } = createBlockedClient();
    const request = client.request("late", {}, 100).catch((error: unknown) => error);
    try {
      callbacks.shift()?.();
      await setImmediate();
      vi.setSystemTime(Date.now() + 100);
      input.write('{"id":1,"result":"late"}\n');
      expect(await request).toMatchObject({ name: "RpcTimeoutError" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("默认出站预算兼容最大 50 MiB 图片经 Base64 膨胀后的请求", async () => {
    const input = new PassThrough();
    let writtenBytes = 0;
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        writtenBytes += chunk.length;
        callback();
      },
    });
    const client = new JsonlRpcClient({ input, output });
    try {
      const base64Bytes = Math.ceil((50 * 1024 * 1024) / 3) * 4;
      const request = client
        .request("turn/start", {
          input: [{ type: "image", url: `data:image/png;base64,${"A".repeat(base64Bytes)}` }],
        })
        .catch((error: unknown) => error);
      await setImmediate();
      expect(writtenBytes).toBeGreaterThan(base64Bytes);
      input.write('{"id":1,"result":"ok"}\n');
      expect(await request).toBe("ok");
      expect(client.closed).toBe(false);
    } finally {
      client.close();
    }
  });
});
