import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";
import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
import { ProjectSourcePanel } from "./project-source-panel.js";

type ProjectSourceDialogProps = Readonly<{
  client: CodexlyWorkbenchClient;
  onClose: () => void;
  previewKind: "image" | "source";
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
}>;

function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

export function ProjectSourceDialog({
  client,
  onClose,
  previewKind,
  projectId,
  reference,
  rootPath,
}: ProjectSourceDialogProps) {
  const titleId = "project-source-dialog-title";

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
        <ProjectSourcePanel
          client={client}
          onClose={onClose}
          previewKind={previewKind}
          projectId={projectId}
          reference={reference}
          {...(rootPath === undefined ? {} : { rootPath })}
        />
      </DialogContent>
    </Dialog>
  );
}
