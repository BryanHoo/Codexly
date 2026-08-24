import { describe, expect, it, vi } from "vitest";
import { RpcConnectionClosedError, RpcTimeoutError } from "./jsonl-rpc-client.js";
import type { RpcResponseError } from "./jsonl-rpc-client.js";
import { createHarness } from "./jsonl-rpc-client.test-support.js";

describe("JsonlRpcClient retry", () => {
  it("rejects a request after its configured timeout", async () => {
    const { client } = createHarness(20);

    await expect(client.request("slow")).rejects.toBeInstanceOf(RpcTimeoutError);
    client.close();
  });

  it("retries an explicitly unqueued overload with bounded jitter", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: {
        baseDelayMs: 100,
        maxDelayMs: 250,
        maxElapsedMs: 1_000,
        maxRetries: 3,
        random: () => 1,
      },
    });
    const request = client.request("overloaded", { value: 1 });

    try {
      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );

      await vi.advanceTimersByTimeAsync(119);
      expect(sentMessages).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sentMessages).toEqual([
        { id: 1, method: "overloaded", params: { value: 1 } },
        { id: 1, method: "overloaded", params: { value: 1 } },
      ]);

      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      await vi.advanceTimersByTimeAsync(239);
      expect(sentMessages).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(sentMessages).toHaveLength(3);

      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      await vi.advanceTimersByTimeAsync(249);
      expect(sentMessages).toHaveLength(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(sentMessages).toHaveLength(4);

      serverOutput.write(`${JSON.stringify({ id: 1, result: { accepted: true } })}\n`);
      await expect(request).resolves.toEqual({ accepted: true });
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("stops retrying an overload after the configured retry count", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: {
        baseDelayMs: 10,
        maxDelayMs: 100,
        maxElapsedMs: 1_000,
        maxRetries: 2,
        random: () => 0.5,
      },
    });
    const request = client.request("overloaded");
    const overloadFrame = `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`;

    try {
      serverOutput.write(overloadFrame);
      await vi.advanceTimersByTimeAsync(10);
      serverOutput.write(overloadFrame);
      await vi.advanceTimersByTimeAsync(20);
      serverOutput.write(overloadFrame);

      await expect(request).rejects.toMatchObject({ code: -32001, message: "busy" });
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(3);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("stops retrying before the configured total retry duration", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: {
        baseDelayMs: 100,
        maxDelayMs: 1_000,
        maxElapsedMs: 250,
        maxRetries: 10,
        random: () => 0.5,
      },
    });
    const request = client.request("overloaded");
    const overloadFrame = `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`;

    try {
      serverOutput.write(overloadFrame);
      await vi.advanceTimersByTimeAsync(100);
      serverOutput.write(overloadFrame);

      await expect(request).rejects.toMatchObject({ code: -32001, message: "busy" });
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(2);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it("cancels a scheduled overload retry when the connection closes", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(1_000, {
      overloadRetry: { baseDelayMs: 100, random: () => 0.5 },
    });
    const request = client.request("overloaded");

    try {
      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      client.close();

      await expect(request).rejects.toBeInstanceOf(RpcConnectionClosedError);
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the original request timeout while waiting to retry", async () => {
    vi.useFakeTimers();
    const { client, sentMessages, serverOutput } = createHarness(50, {
      overloadRetry: { baseDelayMs: 100, random: () => 0.5 },
    });
    const request = client.request("overloaded");
    const outcome = request.catch((error: unknown) => error);

    try {
      serverOutput.write(
        `${JSON.stringify({ error: { code: -32001, data: { retry: true }, message: "busy" }, id: 1 })}\n`,
      );
      await vi.advanceTimersByTimeAsync(50);

      await expect(outcome).resolves.toBeInstanceOf(RpcTimeoutError);
      await vi.runAllTimersAsync();
      expect(sentMessages).toHaveLength(1);
    } finally {
      client.close();
      vi.useRealTimers();
    }
  });

  it.each([
    { code: -32002, data: { retry: true }, label: "non-overload code" },
    { code: -32001, data: { retry: false }, label: "overload without unqueued marker" },
  ])("does not retry $label", async ({ code, data }) => {
    const { client, serverOutput } = createHarness();
    const request = client.request("fails");

    serverOutput.write(`${JSON.stringify({ error: { code, data, message: "failed" }, id: 1 })}\n`);

    await expect(request).rejects.toMatchObject({
      code,
      data,
      message: "failed",
    } satisfies Partial<RpcResponseError>);
    client.close();
  });
});
