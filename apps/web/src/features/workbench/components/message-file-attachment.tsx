import { Link } from "@tanstack/react-router";
import { PdfAttachment } from "@codexly/ui/core/pdf-attachment";
import { classifyMessageAttachment } from "../project-file-reference.js";
import type { AgentMessageAttachment } from "@codexly/protocol";
import type { ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
} from "../../../shared/components/agent/attachments.js";
import { cn } from "../../../shared/lib/utils.js";
import { useIsLanAccess } from "../../access/access-context.js";
import { LanDownloadContextMenu } from "./lan-download-context-menu.js";

type MessageFileAttachmentProps = Readonly<{
  attachment: AgentMessageAttachment;
  children?: ReactNode;
  className?: string;
  url: string;
  projectId?: string;
}>;

export function MessageFileAttachment({
  attachment,
  children,
  className,
  url,
  projectId,
}: MessageFileAttachmentProps) {
  const isLanAccess = useIsLanAccess();
  if (classifyMessageAttachment(attachment) === "pdf") {
    return (
      <PdfAttachment
        wrapTrigger={(trigger) => (
          <LanDownloadContextMenu enabled={isLanAccess} name={attachment.name} url={url}>
            {trigger}
          </LanDownloadContextMenu>
        )}
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
  const card = (
    <LanDownloadContextMenu enabled={isLanAccess} name={attachment.name} url={url}>
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
    </LanDownloadContextMenu>
  );
  const sourceId = attachment.continuationSourceTaskId;
  if (!sourceId || !projectId) return card;
  return (
    <div className="flex flex-col items-start gap-1">
      {card}
      <Link
        {...(projectId === "temporary"
          ? { to: "/temporary/t/$taskId" as const, params: { taskId: sourceId } }
          : { to: "/p/$projectId/t/$taskId" as const, params: { projectId, taskId: sourceId } })}
        className="text-caption text-muted-foreground underline-offset-2 hover:underline"
      >
        {i18n.language === "zh-CN" ? "打开来源任务" : "Open source task"}
      </Link>
    </div>
  );
}
