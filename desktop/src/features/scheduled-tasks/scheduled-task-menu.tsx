import type { ScheduledTask } from "@/protocol/index.js";
import { Ellipsis, Pause, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { TaskDeleteConfirmationDialog } from "../workbench/components/task-delete-dialog.js";

import { useTranslation } from "../../i18n/i18n.js";
import { Button } from "../../shared/components/core/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../shared/components/core/dropdown-menu.js";

export function ScheduledTaskMenu({ task, onDelete, onEnabledChange }: Readonly<{
  task: ScheduledTask;
  onDelete: (id: string) => void | Promise<unknown>;
  onEnabledChange: (id: string, enabled: boolean) => void;
}>) {
  const { t } = useTranslation("workbench");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(task.id);
      setDeleteArmed(false);
    } catch {
      // 错误由全局 mutation 提示，保留弹窗以便重试。
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t("scheduledTasks.taskActions", { name: task.name })}
          className="scheduled-task-row__menu" size="icon-toolbar" variant="ghost">
          <Ellipsis aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="scheduled-task-menu">
        <DropdownMenuItem aria-label={t(task.enabled ? "scheduledTasks.disableTask" : "scheduledTasks.enableTask", { name: task.name })}
          onSelect={() => onEnabledChange(task.id, !task.enabled)}>
          {task.enabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          {t(task.enabled ? "scheduledTasks.disable" : "scheduledTasks.enable")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger" onSelect={() => setDeleteArmed(true)}>
          <Trash2 aria-hidden="true" />{t("scheduledTasks.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {deleteArmed ? <TaskDeleteConfirmationDialog
      title={t("sidebar.deleteTaskTitle")}
      description={t("sidebar.deleteTaskDescription", { task: task.name })}
      confirmLabel={t("scheduledTasks.deleteConfirm")}
      isPending={deleting}
      onClose={() => setDeleteArmed(false)}
      onConfirm={() => { void confirmDelete(); }}
    /> : null}
    </>
  );
}
