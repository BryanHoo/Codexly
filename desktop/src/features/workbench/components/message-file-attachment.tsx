import { TauriWorkspaceClient } from "../../../platform/tauri/workspace-client.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import { PdfAttachment } from "@codexly/ui/core/pdf-attachment";
import { classifyMessageAttachment } from "../project-file-reference.js";
import type { AgentMessageAttachment } from "@/protocol/index.js";
import type { ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
} from "../../../shared/components/agent/attachments.js";
import { cn } from "../../../shared/lib/utils.js";

const pdfClient = new TauriWorkspaceClient({ ensureRuntime: () => Promise.resolve() });

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
  if (classifyMessageAttachment(attachment) === "pdf") {
    return (
      <PdfAttachment
        name={attachment.name}
        src={url}
        labels={{
          open: i18n.t("projectDialog.pdfOpen", { ns: "workbench" }),
          close: i18n.t("projectDialog.closePdfPreview", { ns: "workbench" }),
          unavailable: i18n.t("projectDialog.pdfUnavailable", { ns: "workbench" }),
        }}
        className={cn(
          "block max-w-full rounded-control text-left transition-opacity hover:opacity-90 focus-visible:shadow-focus",
          className,
        )}
        onOpen={() => {
          void pdfClient
            .openProject("temporary", undefined, { appId: "system-default", path: attachment.id })
            .catch(notifyActionError);
        }}
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
      </PdfAttachment>
    );
  }
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
