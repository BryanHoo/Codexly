import type { AgentMessageAttachment } from "@code-agent/protocol";
import type { ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
} from "../../../shared/components/agent/attachments.js";
import { cn } from "../../../shared/lib/utils.js";

type MessageFileAttachmentProps = Readonly<{
  attachment: AgentMessageAttachment;
  children?: ReactNode;
  className?: string;
  url: string;
}>;

export function MessageFileAttachment({
  attachment,
  children,
  className,
  url,
}: MessageFileAttachmentProps) {
  return (
    <a
      aria-label={i18n.t("timeline.downloadAttachment", {
        name: attachment.name,
        ns: "conversation",
      })}
      className={cn(
        "block max-w-full rounded-control transition-opacity hover:opacity-90 focus-visible:shadow-focus",
        className,
      )}
      data-message-attachment={attachment.kind}
      download={attachment.name}
      href={url}
    >
      {children ?? (
        <Attachment
          className="h-12 max-w-64 pe-3 shadow-control"
          data={{ ...attachment, previewUrl: url }}
        >
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      )}
    </a>
  );
}
