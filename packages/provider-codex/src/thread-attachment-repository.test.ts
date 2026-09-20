import { describe, expect, it, vi } from "vitest";

import { CodexProtocolMappingError } from "./codex-protocol-mapping.js";
import {
  CODEXLY_THREAD_ATTACHMENT_TYPE,
  CodexThreadAttachmentRepository,
  type CodexlyThreadAttachmentMetadata,
} from "./thread-attachment-repository.js";

const metadata: CodexlyThreadAttachmentMetadata = {
  attachment: {
    id: "history-attachment-1",
    kind: "image",
    mediaType: "image/png",
    name: "diagram.png",
    size: 8,
  },
  blobKey: "a".repeat(64),
  schemaVersion: 1,
};

describe("CodexThreadAttachmentRepository", () => {
  it("paginates owned attachment metadata and caches the validated result", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            attachmentType: "another.client",
            createdAt: 1,
            id: "foreign-1",
            identityKey: "foreign-key",
            payload: { ignored: true },
          },
          {
            attachmentType: CODEXLY_THREAD_ATTACHMENT_TYPE,
            createdAt: 2,
            id: "native-1",
            identityKey: metadata.attachment.id,
            payload: metadata,
          },
        ],
        nextCursor: "next-page",
      })
      .mockResolvedValueOnce({ data: [], nextCursor: null });
    const repository = new CodexThreadAttachmentRepository({ request });

    await expect(repository.load("task-1")).resolves.toEqual([metadata]);
    await expect(repository.load("task-1")).resolves.toEqual([metadata]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, "thread/attachment/list", {
      limit: 100,
      threadId: "task-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "thread/attachment/list", {
      cursor: "next-page",
      limit: 100,
      threadId: "task-1",
    });
  });

  it("writes idempotent metadata without exposing attachment bytes or local paths", async () => {
    const request = vi.fn().mockResolvedValue({
      attachment: {
        attachmentType: CODEXLY_THREAD_ATTACHMENT_TYPE,
        createdAt: 1,
        id: "native-1",
        identityKey: metadata.attachment.id,
        payload: metadata,
      },
      outcome: "created",
    });
    const repository = new CodexThreadAttachmentRepository({ request });

    await repository.add("task-1", metadata);

    expect(request).toHaveBeenCalledWith("thread/attachment/add", {
      attachmentType: CODEXLY_THREAD_ATTACHMENT_TYPE,
      identityKey: metadata.attachment.id,
      payload: metadata,
      threadId: "task-1",
    });
    const serialized = JSON.stringify(request.mock.calls[0]);
    expect(serialized).not.toContain("base64");
    expect(serialized).not.toContain("/private/");
  });

  it("rejects an existing identity with conflicting metadata", async () => {
    const request = vi.fn().mockResolvedValue({
      attachment: {
        attachmentType: CODEXLY_THREAD_ATTACHMENT_TYPE,
        createdAt: 1,
        id: "native-1",
        identityKey: metadata.attachment.id,
        payload: {
          ...metadata,
          attachment: { ...metadata.attachment, name: "different.png" },
        },
      },
      outcome: "existing",
    });
    const repository = new CodexThreadAttachmentRepository({ request });

    await expect(repository.add("task-1", metadata)).rejects.toThrow(
      "thread/attachment/add returned conflicting metadata",
    );
  });

  it("rejects malformed metadata owned by Codexly", async () => {
    const request = vi.fn().mockResolvedValue({
      data: [
        {
          attachmentType: CODEXLY_THREAD_ATTACHMENT_TYPE,
          createdAt: 1,
          id: "native-1",
          identityKey: "history-attachment-1",
          payload: { ...metadata, blobKey: "../escape" },
        },
      ],
      nextCursor: null,
    });
    const repository = new CodexThreadAttachmentRepository({ request });

    await expect(repository.load("task-1")).rejects.toBeInstanceOf(CodexProtocolMappingError);
  });
});
