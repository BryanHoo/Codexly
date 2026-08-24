import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readStagedImage } from "./jsonl-frame-processor.js";
import { createHarness } from "./jsonl-rpc-client.test-support.js";

describe("JsonlRpcClient frames", () => {
  it("frames split JSONL chunks and correlates out-of-order responses", async () => {
    const { client, sentMessages, serverOutput } = createHarness();
    const first = client.request("first", { value: 1 });
    const second = client.request("second", { value: 2 });

    expect(sentMessages).toEqual([
      { id: 1, method: "first", params: { value: 1 } },
      { id: 2, method: "second", params: { value: 2 } },
    ]);

    serverOutput.write('{"id":2,"result":{"order":"sec');
    serverOutput.write('ond"}}\n{"id":1,"result":{"order":"first"}}\n');

    await expect(second).resolves.toEqual({ order: "second" });
    await expect(first).resolves.toEqual({ order: "first" });
    client.close();
  });

  it("preserves UTF-8 characters split across input chunks", () => {
    const { client, serverOutput } = createHarness();
    const onNotification = vi.fn();
    client.onNotification(onNotification);
    const frame = Buffer.from(
      `${JSON.stringify({ method: "message/delta", params: { text: "你好" } })}\n`,
    );
    const characterStart = frame.indexOf(Buffer.from("你"));

    // 在多字节字符中间切分，模拟 stdout 的任意 Buffer 边界。
    serverOutput.write(frame.subarray(0, characterStart + 1));
    serverOutput.write(frame.subarray(characterStart + 1));

    expect(onNotification).toHaveBeenCalledWith({
      method: "message/delta",
      params: { text: "你好" },
    });
    client.close();
  });

  it("accepts bounded image generation notifications larger than 16 MiB", async () => {
    const { client, serverOutput } = createHarness();
    const onNotification = vi.fn();
    const received = new Promise<void>((resolve) => {
      client.onNotification((notification) => {
        onNotification(notification);
        resolve();
      });
    });
    const result = "A".repeat(17 * 1_024 * 1_024);

    serverOutput.write(
      `${JSON.stringify({
        method: "item/completed",
        params: {
          item: { id: "image-1", result, status: "completed", type: "imageGeneration" },
          threadId: "task-1",
          turnId: "turn-1",
        },
      })}\n`,
    );

    await received;
    expect(onNotification).toHaveBeenCalledOnce();
    expect(client.closed).toBe(false);
    client.close();
  });

  it("keeps large-frame order and stages generated image Base64 in the worker", async () => {
    const { client, serverOutput } = createHarness(1_000, { largeFrameThresholdBytes: 1 });
    const notifications: unknown[] = [];
    const received = new Promise<void>((resolve) => {
      client.onNotification((notification) => {
        notifications.push(notification);
        if (notifications.length === 2) resolve();
      });
    });
    const encoded = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

    serverOutput.write(
      `${JSON.stringify({
        method: "item/completed",
        params: { item: { result: encoded, type: "imageGeneration" } },
      })}\n${JSON.stringify({ method: "turn/completed", params: { id: "turn-1" } })}\n`,
    );

    await received;
    const first = notifications[0] as { params: { item: Record<string, unknown> } };
    const staged = readStagedImage(first.params.item);
    expect(staged).toMatchObject({ mediaType: "image/png", size: 8 });
    expect(existsSync(staged?.path ?? "")).toBe(true);
    expect(first.params.item).not.toHaveProperty("result");
    expect(notifications[1]).toMatchObject({ method: "turn/completed" });
    client.close();
  });

  it("prefers a valid savedPath without returning redundant Base64 to the main thread", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codexly-jsonl-saved-path-"));
    const savedPath = join(directory, "generated.png");
    writeFileSync(savedPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const { client, serverOutput } = createHarness(1_000, { largeFrameThresholdBytes: 1 });
    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.onNotification((notification) => {
        resolve((notification.params as { item: Record<string, unknown> }).item);
      });
    });

    serverOutput.write(
      `${JSON.stringify({
        method: "item/completed",
        params: { item: { result: "redundant", savedPath, type: "imageGeneration" } },
      })}\n`,
    );

    const item = await received;
    expect(item).toMatchObject({ savedPath, type: "imageGeneration" });
    expect(item).not.toHaveProperty("result");
    expect(readStagedImage(item)).toBeUndefined();
    client.close();
    rmSync(directory, { force: true, recursive: true });
  });

  it("closes when a complete JSONL frame exceeds the UTF-8 byte limit", () => {
    const frame = JSON.stringify({ method: "message/delta", params: { text: "你好" } });
    const frameBytes = Buffer.byteLength(frame, "utf8");
    const { client, serverOutput } = createHarness(1_000, {
      maxBufferBytes: frameBytes * 2,
      maxFrameBytes: frameBytes - 1,
    });
    const onError = vi.fn();
    client.onError(onError);

    serverOutput.write(`${frame}\n`);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `RPC JSONL frame exceeds ${String(frameBytes - 1)} bytes (${String(frameBytes)} bytes)`,
      }),
    );
    expect(client.closed).toBe(true);
  });

  it("closes when an unfinished JSONL buffer exceeds the UTF-8 byte limit", () => {
    const { client, serverOutput } = createHarness(1_000, {
      maxBufferBytes: 5,
      maxFrameBytes: 100,
    });
    const onError = vi.fn();
    client.onError(onError);

    // 两个汉字占 6 个 UTF-8 字节，不能按 JavaScript 字符数误判为未超限。
    serverOutput.write("你好");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "RPC unfinished JSONL buffer exceeds 5 bytes (6 bytes)",
      }),
    );
    expect(client.closed).toBe(true);
  });

  it("closes an unfinished frame as soon as it exceeds the frame limit", () => {
    const { client, serverOutput } = createHarness(1_000, {
      maxBufferBytes: 100,
      maxFrameBytes: 5,
    });
    const onError = vi.fn();
    client.onError(onError);

    serverOutput.write("123456");

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "RPC JSONL frame exceeds 5 bytes (6 bytes)",
      }),
    );
    expect(client.closed).toBe(true);
  });

  it("does not copy complete frames from a JSONL burst", () => {
    const { client, serverOutput } = createHarness();
    const onNotification = vi.fn();
    client.onNotification(onNotification);
    const frameCount = 200;
    const burst = Array.from({ length: frameCount }, (_, index) =>
      JSON.stringify({ method: "message/delta", params: { index } }),
    ).join("\n");
    const concatSpy = vi.spyOn(Buffer, "concat");

    try {
      serverOutput.write(`${burst}\n`);

      expect(onNotification).toHaveBeenCalledTimes(frameCount);
      expect(onNotification.mock.calls.at(-1)?.[0]).toEqual({
        method: "message/delta",
        params: { index: frameCount - 1 },
      });
      expect(concatSpy).not.toHaveBeenCalled();
    } finally {
      concatSpy.mockRestore();
      client.close();
    }
  });
});
