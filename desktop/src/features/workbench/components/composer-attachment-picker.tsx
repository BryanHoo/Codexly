import type { ReactNode } from "react";
import type { WorkbenchComposerProps } from "./workbench-composer-contracts.js";
import type { useComposerSession } from "./workbench-composer-session.js";
import { HostAttachmentPickerDialog } from "./host-attachment-picker-dialog.js";

/** 保留原附件选择的作用域校验，迟到结果不能写入切换后的任务。 */
export function ComposerAttachmentPicker({
  client,
  projectId,
  session,
  children,
}: Readonly<{
  client: WorkbenchComposerProps["client"];
  projectId: string;
  session: ReturnType<typeof useComposerSession>;
  children: ReactNode;
}>) {
  if (session.attachmentPickerKind === undefined || session.draftInputDisabled) return children;
  return (
    <>
      {children}
      <HostAttachmentPickerDialog
        client={client}
        projectId={projectId}
        kind={session.attachmentPickerKind}
        onClose={() => session.setAttachmentPickerKind(undefined)}
        onAdd={(attachment) => {
          if (!session.composerController.isCurrentScope(session.routeScope)) return;
          session.handleAttachmentsChange([...session.attachments, attachment]);
          session.setAttachmentPickerKind(undefined);
        }}
      />
    </>
  );
}
