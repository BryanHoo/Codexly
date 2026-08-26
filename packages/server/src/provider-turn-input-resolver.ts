import { Readable } from "node:stream";

import type { AgentProvider, AgentProviderTurnInput } from "@codexly/core";
import {
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  type AgentPromptInput,
} from "@codexly/protocol";

import { AttachmentNotFoundError, type AttachmentStore } from "./attachment-store.js";
import { MutationHttpError } from "./routes/context.js";

export function createProviderTurnInputResolver(attachmentStore: AttachmentStore) {
  return async (
    projectId: string,
    input: AgentPromptInput,
    provider?: AgentProvider,
    taskId?: string,
  ): Promise<
    Readonly<{ attachmentIds: readonly string[]; providerInput: AgentProviderTurnInput }>
  > => {
    const requestedIds = input.attachments.map((attachment) => attachment.id);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new MutationHttpError("INVALID_REQUEST", "Duplicate attachments are not allowed", 400);
    }
    const attachmentIds: string[] = [];
    const attachments = [];
    for (const requestedId of requestedIds) {
      try {
        const [resolved] = await attachmentStore.resolve(projectId, [requestedId]);
        if (resolved !== undefined) {
          attachmentIds.push(requestedId);
          attachments.push(resolved);
          continue;
        }
      } catch (error) {
        if (!(error instanceof AttachmentNotFoundError)) throw error;
      }
      const historical =
        provider === undefined || taskId === undefined
          ? undefined
          : await provider.readTaskAttachment(taskId, requestedId);
      if (historical === undefined) {
        throw new MutationHttpError(
          "ATTACHMENT_NOT_FOUND",
          "Attachment was not found or has expired",
          404,
        );
      }
      // 历史或队列附件重新进入待提交 Store，后续仍走统一大小与类型校验。
      const cloned = await attachmentStore.add(projectId, {
        content: Readable.from([historical.content]),
        kind: historical.kind,
        mediaType: historical.mediaType,
        name: historical.name,
      });
      const [resolved] = await attachmentStore.resolve(projectId, [cloned.attachment.id]);
      if (resolved !== undefined) {
        attachmentIds.push(cloned.attachment.id);
        attachments.push(resolved);
      }
    }
    const imageBytes = attachments.reduce(
      (total, attachment) => total + (attachment.kind === "image" ? attachment.size : 0),
      0,
    );
    const fileBytes = attachments.reduce(
      (total, attachment) => total + (attachment.kind === "image" ? 0 : attachment.size),
      0,
    );
    const imageCount = attachments.filter((attachment) => attachment.kind === "image").length;
    if (imageCount > MAX_AGENT_IMAGES || imageBytes > MAX_AGENT_IMAGE_TOTAL_BYTES) {
      throw new MutationHttpError("INVALID_REQUEST", "Image input limit exceeded", 400);
    }
    if (fileBytes > MAX_AGENT_FILE_TOTAL_BYTES) {
      throw new MutationHttpError("INVALID_REQUEST", "File input limit exceeded", 400);
    }
    // Start、steer 与持久队列共用映射，保证 Provider 输入语义一致。
    return {
      attachmentIds,
      providerInput: {
        files: attachments.flatMap((attachment) =>
          attachment.kind === "file"
            ? [{ mediaType: attachment.mediaType, name: attachment.name, path: attachment.path }]
            : [],
        ),
        images: attachments.flatMap((attachment) =>
          attachment.kind === "image"
            ? [{ mediaType: attachment.mediaType, url: attachment.url }]
            : [],
        ),
        skills: input.skills,
        text: input.text,
        textAttachments: attachments.flatMap((attachment) =>
          attachment.kind === "text" ? [{ name: attachment.name, text: attachment.text }] : [],
        ),
      },
    };
  };
}
