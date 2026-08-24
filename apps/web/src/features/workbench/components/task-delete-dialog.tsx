import type { AgentTask } from "@code-agent/protocol";

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

type TaskDeleteDialogProps = Readonly<{
  isPending: boolean;
  onClose: () => void;
  onDelete: () => void;
  task: AgentTask;
}>;

type TaskDeleteConfirmationDialogProps = Readonly<{
  confirmLabel: string;
  description: string;
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
}>;

export function TaskDeleteConfirmationDialog({
  confirmLabel,
  description,
  isPending,
  onClose,
  onConfirm,
  title,
}: TaskDeleteConfirmationDialogProps) {
  const { t } = useTranslation("workbench");

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isPending) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby="task-delete-confirmation-title"
        className="max-w-96 p-4"
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle id="task-delete-confirmation-title">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={isPending} onClick={onClose} type="button" variant="ghost">
            {t("actions.cancel")}
          </Button>
          <Button disabled={isPending} onClick={onConfirm} type="button" variant="destructive">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TaskDeleteDialog({ isPending, onClose, onDelete, task }: TaskDeleteDialogProps) {
  const { t } = useTranslation("workbench");

  return (
    <TaskDeleteConfirmationDialog
      confirmLabel={t("sidebar.deletePermanently")}
      description={t("sidebar.deleteTaskDescription", { task: task.title })}
      isPending={isPending}
      onClose={onClose}
      onConfirm={onDelete}
      title={t("sidebar.deleteTaskTitle")}
    />
  );
}
