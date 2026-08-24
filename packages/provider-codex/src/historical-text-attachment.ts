import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { MAX_AGENT_TEXT_BYTES, type AgentMessageAttachment } from "@codexly/protocol";

import { normalizeAttachmentName } from "./historical-attachment-files.js";
import type { StoredHistoricalAttachment } from "./historical-local-file-attachment.js";

type AddHistoricalTextOptions = Readonly<{
  addManaged: (
    name: string,
    content: Buffer,
    contentDigest: string,
  ) => AgentMessageAttachment | undefined;
  entries: Iterable<StoredHistoricalAttachment>;
  input: Readonly<{ name: string; text: string }>;
  refresh: (entry: StoredHistoricalAttachment) => AgentMessageAttachment;
  taskId: string;
  textIndex: number;
}>;

export function addHistoricalText({
  addManaged,
  entries,
  input,
  refresh,
  taskId,
  textIndex,
}: AddHistoricalTextOptions): AgentMessageAttachment | undefined {
  const content = Buffer.from(input.text, "utf8");
  if (content.byteLength === 0 || content.byteLength > MAX_AGENT_TEXT_BYTES) {
    return undefined;
  }
  const name = normalizeAttachmentName(input.name, `Pasted text-${String(textIndex + 1)}.txt`);
  const contentDigest = createHash("sha256").update(content).digest("hex");
  for (const entry of entries) {
    if (
      entry.source === "managed" &&
      entry.projectTaskId === taskId &&
      entry.attachment.kind === "text" &&
      entry.attachment.name === name &&
      entry.attachment.size === content.byteLength &&
      entry.contentDigest === contentDigest
    ) {
      return refresh(entry);
    }
  }
  return addManaged(name, content, contentDigest);
}
