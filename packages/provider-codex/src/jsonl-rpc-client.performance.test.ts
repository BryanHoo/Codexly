import { PassThrough, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import performanceBudgets from "../../../tests/performance-budgets.json" with { type: "json" };
import { JsonlRpcClient } from "./jsonl-rpc-client.js";

const MAX_FRAME_BYTES = 64 * 1_024 * 1_024;

describe("JsonlRpcClient performance", () => {
  it("assembles a near-limit fragmented frame with one historical-data copy", async () => {
    const { chunkBytes, frameBytes, maxAssemblyMs } = performanceBudgets.jsonlFragmentation;
    const input = new PassThrough();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const client = new JsonlRpcClient({
      input,
      largeFrameThresholdBytes: 1,
      maxBufferBytes: MAX_FRAME_BYTES,
      maxFrameBytes: MAX_FRAME_BYTES,
      output,
    });
    const received = new Promise<void>((resolve) => {
      client.onNotification(() => {
        resolve();
      });
    });
    const prefix = Buffer.from('{"method":"performance/frame","params":{"data":"');
    const suffix = Buffer.from('"}}');
    const frame = Buffer.alloc(frameBytes, 0x41);
    prefix.copy(frame);
    suffix.copy(frame, frame.length - suffix.length);
    const concatSpy = vi.spyOn(Buffer, "concat");

    try {
      const startedAt = performance.now();
      // 大量小 chunk 模拟 Base64 帧在 stdout 管道中的最差碎片形态。
      for (let offset = 0; offset < frame.length; offset += chunkBytes) {
        input.write(frame.subarray(offset, Math.min(offset + chunkBytes, frame.length)));
      }
      input.write("\n");
      const durationMs = performance.now() - startedAt;

      expect(concatSpy).toHaveBeenCalledOnce();
      expect(durationMs).toBeLessThan(maxAssemblyMs);
      await received;
      expect(client.closed).toBe(false);
    } finally {
      concatSpy.mockRestore();
      client.close();
    }
  });
});
