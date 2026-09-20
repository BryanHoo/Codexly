import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import {
  FakeRpcClient,
  createCodexAgentProvider,
  nativeThread,
  project,
} from "./agent-provider.test-support.js";

test("restores stable attachment metadata and bytes after rebuilding the provider", async () => {
  const attachmentDirectory = await mkdtemp(join(tmpdir(), "codexly-thread-attachments-"));
  const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const encodedImage = imageContent.toString("base64");
  const thread = nativeThread({
    turns: [
      {
        completedAt: 1_753_232_400,
        error: null,
        id: "turn-generated-image",
        items: [
          {
            id: "generated-image-1",
            failure: null,
            result: encodedImage,
            revisedPrompt: "一张架构图",
            status: "completed",
            type: "imageGeneration",
          },
        ],
        startedAt: 1_753_228_800,
        status: "completed",
      },
    ],
  });
  const attachments: unknown[] = [];
  let attachmentListCalls = 0;
  const createClient = (readCount = 1) => {
    const rpc = new FakeRpcClient(Array.from({ length: readCount }, () => ({ thread })));
    const originalRequest = rpc.request.bind(rpc);
    rpc.request = (method: string, params?: unknown) => {
      if (method === "thread/attachment/list") {
        attachmentListCalls += 1;
        return Promise.resolve({ data: attachments, nextCursor: null });
      }
      if (method === "thread/attachment/add") {
        const input = params as Record<string, unknown>;
        const attachment = {
          attachmentType: input["attachmentType"],
          createdAt: 1,
          id: `native-${String(attachments.length + 1)}`,
          identityKey: input["identityKey"],
          payload: input["payload"],
        };
        attachments.push(attachment);
        return Promise.resolve({ attachment, outcome: "created" });
      }
      return originalRequest(method, params);
    };
    return rpc;
  };

  try {
    const firstClient = createClient(2);
    const firstProvider = createCodexAgentProvider({
      attachmentDirectory,
      client: firstClient,
      project,
    });
    const firstSnapshot = await firstProvider.readTask("task-1");
    const firstItem = firstSnapshot?.turns[0]?.items[0];
    const attachmentId = firstItem?.type === "message" ? firstItem.attachments?.[0]?.id : undefined;
    expect(attachmentId).toBeDefined();
    firstClient.emitNotification("thread/attachment/updated", {
      attachmentId: "native-1",
      attachmentType: "codexly.history.v1",
      identityKey: attachmentId,
      operation: "created",
      threadId: "task-1",
    });
    await firstProvider.readTask("task-1");
    expect(attachmentListCalls).toBe(2);
    await firstProvider.releaseProject();

    const restoredProvider = createCodexAgentProvider({
      attachmentDirectory,
      client: createClient(),
      project,
    });
    const restoredSnapshot = await restoredProvider.readTask("task-1");
    const restoredItem = restoredSnapshot?.turns[0]?.items[0];
    expect(restoredItem?.type === "message" ? restoredItem.attachments?.[0]?.id : undefined).toBe(
      attachmentId,
    );
    await expect(
      restoredProvider.readTaskAttachment("task-1", attachmentId ?? ""),
    ).resolves.toMatchObject({ content: imageContent, mediaType: "image/png" });
    expect(JSON.stringify(attachments)).not.toContain(encodedImage);
    await restoredProvider.releaseProject();
  } finally {
    await rm(attachmentDirectory, { force: true, recursive: true });
  }
});
