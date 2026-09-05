import { Buffer } from "node:buffer";

import type { ScheduledTaskAttachmentRecord } from "@codexly/core";
import type { FastifyReply } from "fastify";

export function sendScheduledTaskAttachment(
  reply: FastifyReply,
  stored: ScheduledTaskAttachmentRecord,
) {
  return reply
    .header("x-content-type-options", "nosniff")
    .type(stored.attachment.mediaType)
    .send(Buffer.from(stored.content));
}
