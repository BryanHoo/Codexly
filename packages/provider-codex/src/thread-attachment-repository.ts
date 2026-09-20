import {
  MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES,
  type AgentMessageAttachment,
} from "@codexly/protocol";

import type { CodexRpcClient } from "./codex-rpc-client.js";
import {
  CodexProtocolMappingError,
  expectRecord,
  expectString,
  isRecord,
} from "./codex-protocol-mapping.js";

export const CODEXLY_THREAD_ATTACHMENT_TYPE = "codexly.history.v1";
const THREAD_ATTACHMENT_PAGE_SIZE = 100;
const BLOB_KEY_PATTERN = /^[a-f0-9]{64}$/u;

export type CodexlyThreadAttachmentMetadata = Readonly<{
  attachment: AgentMessageAttachment;
  blobKey: string;
  schemaVersion: 1;
}>;

function readAttachment(value: unknown): AgentMessageAttachment {
  const attachment = expectRecord(value, "Codexly thread attachment payload attachment");
  const id = expectString(attachment["id"], "Codexly thread attachment id");
  const kind = attachment["kind"];
  const mediaType = expectString(attachment["mediaType"], "Codexly thread attachment mediaType");
  const name = expectString(attachment["name"], "Codexly thread attachment name");
  const size = attachment["size"];
  if (
    (kind !== "file" && kind !== "image" && kind !== "text") ||
    id.length === 0 ||
    id.length > 256 ||
    mediaType.length === 0 ||
    mediaType.length > 255 ||
    name.length === 0 ||
    name.length > 255 ||
    !Number.isSafeInteger(size) ||
    typeof size !== "number" ||
    size <= 0 ||
    size > MAX_AGENT_HISTORY_IMAGE_TOTAL_BYTES
  ) {
    throw new CodexProtocolMappingError("Codexly thread attachment metadata is invalid");
  }
  return { id, kind, mediaType, name, size };
}

function readMetadata(value: unknown, identityKey: string): CodexlyThreadAttachmentMetadata {
  const payload = expectRecord(value, "Codexly thread attachment payload");
  const attachment = readAttachment(payload["attachment"]);
  const blobKey = expectString(payload["blobKey"], "Codexly thread attachment blobKey");
  if (
    payload["schemaVersion"] !== 1 ||
    attachment.id !== identityKey ||
    !BLOB_KEY_PATTERN.test(blobKey)
  ) {
    throw new CodexProtocolMappingError("Codexly thread attachment payload is invalid");
  }
  return { attachment, blobKey, schemaVersion: 1 };
}

export class CodexThreadAttachmentRepository {
  readonly #cache = new Map<string, readonly CodexlyThreadAttachmentMetadata[]>();

  public constructor(private readonly client: Pick<CodexRpcClient, "request">) {}

  public async load(threadId: string): Promise<readonly CodexlyThreadAttachmentMetadata[]> {
    const cached = this.#cache.get(threadId);
    if (cached !== undefined) return cached;

    const metadata: CodexlyThreadAttachmentMetadata[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const response = expectRecord(
        await this.client.request("thread/attachment/list", {
          ...(cursor === undefined ? {} : { cursor }),
          limit: THREAD_ATTACHMENT_PAGE_SIZE,
          threadId,
        }),
        "thread/attachment/list response",
      );
      const data = response["data"];
      if (!Array.isArray(data)) {
        throw new CodexProtocolMappingError("thread/attachment/list data must be an array");
      }
      for (const value of data) {
        const attachment = expectRecord(value, "thread/attachment/list attachment");
        if (attachment["attachmentType"] !== CODEXLY_THREAD_ATTACHMENT_TYPE) continue;
        const identityKey = expectString(
          attachment["identityKey"],
          "thread/attachment/list identityKey",
        );
        metadata.push(readMetadata(attachment["payload"], identityKey));
      }
      const nextCursor = response["nextCursor"];
      if (nextCursor === null) break;
      cursor = expectString(nextCursor, "thread/attachment/list nextCursor");
      if (cursor.length === 0 || seenCursors.has(cursor)) {
        throw new CodexProtocolMappingError("thread/attachment/list returned an invalid cursor");
      }
      seenCursors.add(cursor);
    }

    this.#cache.set(threadId, metadata);
    return metadata;
  }

  public async add(threadId: string, metadata: CodexlyThreadAttachmentMetadata): Promise<void> {
    const response = expectRecord(
      await this.client.request("thread/attachment/add", {
        attachmentType: CODEXLY_THREAD_ATTACHMENT_TYPE,
        identityKey: metadata.attachment.id,
        payload: metadata,
        threadId,
      }),
      "thread/attachment/add response",
    );
    const nativeAttachment = expectRecord(
      response["attachment"],
      "thread/attachment/add attachment",
    );
    if (
      nativeAttachment["attachmentType"] !== CODEXLY_THREAD_ATTACHMENT_TYPE ||
      nativeAttachment["identityKey"] !== metadata.attachment.id ||
      !isRecord(nativeAttachment["payload"])
    ) {
      throw new CodexProtocolMappingError("thread/attachment/add returned another attachment");
    }
    const persisted = readMetadata(nativeAttachment["payload"], metadata.attachment.id);
    if (JSON.stringify(persisted) !== JSON.stringify(metadata)) {
      throw new CodexProtocolMappingError("thread/attachment/add returned conflicting metadata");
    }
    this.#cache.delete(threadId);
  }

  public invalidate(threadId: string): void {
    this.#cache.delete(threadId);
  }

  public clear(): void {
    this.#cache.clear();
  }
}
