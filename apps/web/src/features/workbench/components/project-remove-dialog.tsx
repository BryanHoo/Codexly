import type { Project } from "@code-agent/protocol";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";

type ProjectRemoveDialogProps = Readonly<{
  isPending: boolean;
  onClose: () => void;
  onRemove: () => void;
  project: Project;
}>;

export function ProjectRemoveDialog({
  isPending,
  onClose,
  onRemove,
  project,
}: ProjectRemoveDialogProps) {
  const { t } = useTranslation("workbench");

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onClose();
        }
      }}
      open
    >
      <DialogContent
        aria-labelledby="project-remove-title"
        className="max-w-96 p-4"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle id="project-remove-title">{t("projectDialog.remove")}</DialogTitle>
          <DialogDescription>
            {t("projectDialog.removeDescription", { name: project.name })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            className="h-8 rounded-control px-3 text-body-small text-muted-foreground hover:bg-control-hover hover:text-foreground"
            disabled={isPending}
            onClick={onClose}
            type="button"
            variant="ghost"
          >
            {t("actions.cancel")}
          </Button>
          <Button disabled={isPending} onClick={onRemove} type="button" variant="destructive">
            {t("projectDialog.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
