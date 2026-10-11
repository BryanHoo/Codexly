import { setImmediate } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { createHarness } from "./jsonl-rpc-client.test-support.js";

describe("JsonlRpcClient cancellation", () => {
  it("取消已中止的请求时不写入传输流", async () => {
    const { client, sentMessages } = createHarness();
    const controller = new AbortController();
    controller.abort();
    try {
      await expect(
        client.request("thread/search", {}, undefined, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(sentMessages).toEqual([]);
    } finally {
      client.close();
    }
  });

  it("取消时移除等待项、监听器及重试计时器，并忽略迟到响应", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: { baseDelayMs: 100, random: () => 0.5 },
    });
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const request = client.request("thread/search", {}, undefined, controller.signal);
    const outcome = expect(request).rejects.toMatchObject({ name: "AbortError" });
    const overload = `${JSON.stringify({
      id: 1,
      error: {
        code: -32001,
        data: { retry: true },
        message: "busy",
      },
    })}\n`;
    try {
      // 等流写入回调完成，随后只观察请求超时和过载重试计时器。
      await setImmediate();
      serverOutput.write(overload);
      controller.abort();
      await outcome;
      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(vi.getTimerCount()).toBe(0);
      // 迟到的过载响应若仍能找到等待项，就会重新建立重试计时器。
      serverOutput.write(overload);
      expect(vi.getTimerCount()).toBe(0);
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(1);
      const other = client.request("unrelated");
      serverOutput.write(`${JSON.stringify({ id: 2, result: "ok" })}\n`);
      await expect(other).resolves.toBe("ok");
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it.each(["success", "error", "timeout", "close"] as const)(
    "%s 结束请求时解除取消监听",
    async (finish) => {
      vi.useFakeTimers();
      const { client, serverOutput } = createHarness(100);
      const controller = new AbortController();
      const removeListener = vi.spyOn(controller.signal, "removeEventListener");
      const outcome = client
        .request("thread/search", {}, undefined, controller.signal)
        .catch((error: unknown) => error);
      try {
        await setImmediate();
        if (finish === "success") serverOutput.write('{"id":1,"result":null}\n');
        if (finish === "error")
          serverOutput.write('{"id":1,"error":{"code":-1,"message":"failed"}}\n');
        if (finish === "timeout") await vi.advanceTimersByTimeAsync(100);
        if (finish === "close") client.close();
        await outcome;
        expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        client.close();
        vi.useRealTimers();
      }
    },
  );
});
