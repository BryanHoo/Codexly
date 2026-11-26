import {
  TaskRenameDialog as SharedTaskRenameDialog,
  type TaskRenameDialogProps,
} from "@codexly/ui/core/task-rename-dialog";
import { useTranslation } from "../../../i18n/i18n.js";

export function TaskRenameDialog(props: TaskRenameDialogProps) {
  const { t } = useTranslation("workbench");
  return (
    <SharedTaskRenameDialog
      {...props}
      labels={{
        title: t("taskDialog.rename"),
        name: t("taskDialog.name"),
        cancel: t("actions.cancel"),
        save: t("actions.save"),
        close: t("actions.close"),
      }}
    />
  );
}
