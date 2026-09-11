import { Buffer } from "node:buffer";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  createCodexAgentProvider,
  FakeRpcClient,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

it("restores steered images after uploaded temporary files are released", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codexly-steer-images-"));
  const path = join(directory, "image.png");
  const content = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  try {
    await writeFile(path, content);
    const rpc = new FakeRpcClient([{ thread: nativeThread() }, { turnId: "turn-1" }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    await provider.startTask();
    await provider.steerTurn("task-1", "turn-1", {
      files: [],
      images: [{ detail: "original", mediaType: "image/png", path }],
      skills: [],
      text: "查看这张图片",
      textAttachments: [],
    });
    const params = rpc.calls.at(-1)?.params as { input: unknown[] };
    // 模拟 Turn 清理上传文件，再通过新的 Provider 恢复原生消息，避免缓存掩盖丢图。
    await unlink(path);
    const historyRpc = new FakeRpcClient([
      {
        thread: nativeThread({
          turns: [
            {
              completedAt: 1_753_228_801,
              durationMs: 1_000,
              error: null,
              id: "turn-1",
              items: [{ content: params.input, id: "steer-user", type: "userMessage" }],
              itemsView: { type: "full" },
              startedAt: 1_753_228_800,
              status: "completed",
            },
          ],
        }),
      },
    ]);
    const restoredProvider = createCodexAgentProvider({ client: historyRpc, project });
    const task = await restoredProvider.readTask("task-1");
    const message = task?.turns[0]?.items[0];
    expect(message).toMatchObject({
      attachments: [{ kind: "image", mediaType: "image/png", size: content.byteLength }],
      role: "user",
      text: "查看这张图片",
    });
    if (message?.type !== "message" || message.attachments?.[0] === undefined) {
      throw new Error("Expected steered image attachment");
    }
    await expect(
      restoredProvider.readTaskAttachment("task-1", message.attachments[0].id),
    ).resolves.toMatchObject({ content });
    expect(params.input.at(-1)).toMatchObject({ detail: "original" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
