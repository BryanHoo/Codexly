import { describe, expect, it } from "vitest";

import type { QueuedComposerPrompt } from "./composer-queue-state.js";
import {
  hasQueuedPromptReceivedUserMessageInSnapshot,
  mapAgentQueuedSubmission,
  retainAcceptedSteerPrompt,
  resolveQueuedPromptEdit,
} from "./composer-queue-state.js";

const waitingPrompt: QueuedComposerPrompt = {
  files: [],
  id: "steer-1",
  skills: [],
  status: "awaiting-response",
  text: "补充失败测试",
  turnId: "turn-1",
  userMessageIds: ["user-before"],
};

const queuedPrompt: QueuedComposerPrompt = {
  files: [],
  id: "queued-1",
  skills: [],
  status: "queued",
  text: "补充失败测试",
};

describe("composer queue state", () => {
  it("keeps accepted steer loading when only an assistant message streams", () => {
    expect(
      hasQueuedPromptReceivedUserMessageInSnapshot(waitingPrompt, {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "assistant-before",
                role: "assistant",
                text: "回复",
                type: "message",
              },
            ],
          },
        ],
      }),
    ).toBe(false);
  });

  it("allows editing only before a queued prompt is accepted as a steer", () => {
    expect(resolveQueuedPromptEdit(queuedPrompt)).toEqual({
      files: [],
      skills: [],
      text: "补充失败测试",
    });
    expect(resolveQueuedPromptEdit(waitingPrompt)).toBeUndefined();
  });

  it("adds loading when a server queued prompt is accepted as a steer", () => {
    expect(
      retainAcceptedSteerPrompt(
        [],
        {
          files: [],
          id: queuedPrompt.id,
          skills: [],
          text: queuedPrompt.text,
          turnId: "turn-1",
          userMessageIds: [],
        },
        () => "generated-id",
      ),
    ).toEqual([expect.objectContaining({ id: queuedPrompt.id, status: "awaiting-response" })]);
  });

  it("dismisses steer loading when the streamed user message appears", () => {
    expect(
      hasQueuedPromptReceivedUserMessageInSnapshot(waitingPrompt, {
        turns: [
          {
            id: "turn-1",
            items: [
              { id: "user-before", role: "user", text: "之前", type: "message" },
              { id: "user-after", role: "user", text: "补充失败测试", type: "message" },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it("maps queued image and file metadata to reusable host attachments", () => {
    const prompt = mapAgentQueuedSubmission(
      {
        attachments: [
          { id: "image-1", kind: "image", mediaType: "image/png", name: "图.png", size: 12 },
          {
            id: "file-1",
            kind: "file",
            mediaType: "application/pdf",
            name: "说明.pdf",
            size: 24,
          },
        ],
        clientUserMessageId: "message-1",
        id: "queue-1",
        skills: [],
        text: "检查附件",
      },
      "project-1",
      "task-1",
      (_projectId, _taskId, attachmentId) => `/attachments/${attachmentId}`,
      [],
    );

    expect(prompt.files).toEqual([
      expect.objectContaining({
        id: "image-1",
        previewUrl: "/attachments/image-1",
        source: "host",
      }),
      expect.objectContaining({ id: "file-1", previewUrl: "/attachments/file-1", source: "host" }),
    ]);
  });
});
