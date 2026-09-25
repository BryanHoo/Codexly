import { FileCode2, FileDiff, LoaderCircle, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { FileDiffPanel } from "../../diff/file-diff-panel.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import type { NativeSourceFileClient } from "../../projects/project-query-contracts.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

type ProjectSourceDialogProps = Readonly<{
  change?: AgentFileChange;
  client: NativeSourceFileClient;
  loadDiff?: (change: AgentFileChange) => Promise<AgentFileChange>;
  onClose: () => void;
  previewKind: "image" | "source";
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
}>;

function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

function ProjectDialogAction({
  children,
  disabled = false,
  label,
  onClick,
}: Readonly<{
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ProjectSourceDialog({
  change,
  client,
  loadDiff,
  onClose,
  previewKind,
  projectId,
  reference,
  rootPath,
}: ProjectSourceDialogProps) {
  const { t } = useTranslation("workbench");
  const [diffChange, setDiffChange] = useState<AgentFileChange | null>(null);
  const [diffPending, setDiffPending] = useState(false);
  const titleId = "project-source-dialog-title";
  const showDiff = () => {
    if (change === undefined || loadDiff === undefined || diffPending) return;
    setDiffPending(true);
    // Diff 仅在用户点击后读取，保持普通文件预览的传输与渲染开销不变。
    void loadDiff(change)
      .then(setDiffChange)
      .catch((error: unknown) => {
        notifyActionError(error instanceof Error ? error : new Error("Git diff is unavailable"));
      })
      .finally(() => {
        setDiffPending(false);
      });
  };
  const diffButton =
    change === undefined || loadDiff === undefined ? null : (
      <ProjectDialogAction
        disabled={diffPending}
        label={t("projectDialog.showDiff")}
        onClick={showDiff}
      >
        {diffPending ? (
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <FileDiff aria-hidden="true" className="size-3.5" />
        )}
      </ProjectDialogAction>
    );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby={titleId}
        className="h-[min(82dvh,54rem)] max-w-[72rem] overflow-hidden p-0"
      >
        <DialogTitle className="sr-only" id={titleId}>
          {getFileName(reference.path)}
        </DialogTitle>
        {diffChange === null ? (
          <ProjectSourcePanel
            client={client}
            headerActions={diffButton}
            onClose={onClose}
            previewKind={previewKind}
            projectId={projectId}
            reference={reference}
            {...(rootPath === undefined ? {} : { rootPath })}
          />
        ) : (
          <FileDiffPanel
            actions={
              <>
                <ProjectDialogAction
                  label={t("projectDialog.showSource")}
                  onClick={() => {
                    setDiffChange(null);
                  }}
                >
                  <FileCode2 aria-hidden="true" className="size-3.5" />
                </ProjectDialogAction>
                <ProjectDialogAction label={t("diff.close")} onClick={onClose}>
                  <X aria-hidden="true" className="size-3.5" />
                </ProjectDialogAction>
              </>
            }
            change={diffChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
