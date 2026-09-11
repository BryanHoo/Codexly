import { Buffer } from "node:buffer";

import { MAX_AGENT_IMAGE_BYTES, MAX_AGENT_IMAGE_TOTAL_BYTES } from "@codexly/protocol";
import { expect, it } from "vitest";

import { readStagedImage } from "./jsonl-frame-processor.js";
import { createHarness } from "./jsonl-rpc-client.test-support.js";

it("accepts a user message containing the maximum total uploaded image bytes", async () => {
  const { client, serverOutput } = createHarness();
  try {
    const received = new Promise<unknown>((resolve, reject) => {
      client.onNotification(resolve);
      client.onError(reject);
    });
    const image = Buffer.alloc(MAX_AGENT_IMAGE_BYTES);
    image.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const url = `data:image/png;base64,${image.toString("base64")}`;
    const content = Array.from(
      { length: MAX_AGENT_IMAGE_TOTAL_BYTES / MAX_AGENT_IMAGE_BYTES },
      () => ({ type: "image", url }),
    );
    // 上传上限经过 Base64 膨胀后仍必须能接收，不能在引导回显时关闭 RPC 连接。
    serverOutput.write(
      `${JSON.stringify({ method: "item/completed", params: { item: { content, type: "userMessage" } } })}\n`,
    );
    const notification = (await received) as {
      params: { item: { content: Record<string, unknown>[] } };
    };
    expect(notification.params.item.content).toHaveLength(content.length);
    for (const part of notification.params.item.content) {
      expect(readStagedImage(part)).toMatchObject({
        mediaType: "image/png",
        size: MAX_AGENT_IMAGE_BYTES,
      });
    }
    expect(client.closed).toBe(false);
  } finally {
    client.close();
  }
});
