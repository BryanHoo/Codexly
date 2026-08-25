import { X } from "lucide-react";

import type { ProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import { useTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { Task, TaskTrigger } from "../../../shared/components/agent/task.js";
import type { SubagentSelection } from "./subagent.js";
import { toSubagentTaskStatus } from "./subagent.js";
import { TaskTimeline } from "./task-timeline.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";

type SubagentOutputDialogProps = Readonly<{
  onClose: () => void;
  projectId: string;
  projectRuntime: ProjectRuntimeManager;
  selection: SubagentSelection | null;
}>;

function SubagentOutputState({
  message,
  role,
}: Readonly<{ message: string; role?: "alert" | "status" }>) {
  return (
    <div
      className="grid min-h-0 flex-1 place-items-center px-6 text-sm text-muted-foreground"
      role={role}
    >
      {message}
    </div>
  );
}

export function SubagentOutputDialog({
  onClose,
  projectId,
  projectRuntime,
  selection,
}: SubagentOutputDialogProps) {
  if (selection === null) {
    return null;
  }
  return (
    <OpenSubagentOutputDialog
      onClose={onClose}
      projectId={projectId}
      projectRuntime={projectRuntime}
      selection={selection}
    />
  );
}

function OpenSubagentOutputDialog({
  onClose,
  projectId,
  projectRuntime,
  selection,
}: Readonly<Omit<SubagentOutputDialogProps, "selection"> & { selection: SubagentSelection }>) {
  const { t } = useTranslation("workbench");
  const runtime = useTaskRuntime(projectId, selection.taskId, projectRuntime);

  const titleId = "subagent-output-dialog-title";
  let content;
  if (runtime.error !== null) {
    content = <SubagentOutputState message={t("subagentOutput.error")} role="alert" />;
  } else if (runtime.isPending || runtime.metadata === undefined) {
    content = <SubagentOutputState message={t("subagentOutput.loading")} role="status" />;
  } else {
    content = (
      <>
        {runtime.connectionState === "reconnecting" ? (
          <div
            className="bg-control px-3 py-1.5 text-center text-label text-muted-foreground"
            role="status"
          >
            {t("subagentOutput.reconnecting")}
          </div>
        ) : null}
        <TaskTimeline projectId={projectId} runtime={runtime} taskId={selection.taskId} />
      </>
    );
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby={titleId}
        className="h-[min(86dvh,58rem)] max-w-[76rem] overflow-hidden p-0"
        data-subagent-output-dialog=""
      >
        <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
          <header className="flex min-h-toolbar items-center gap-3 px-3 shadow-toolbar sm:px-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-body-small" id={titleId}>
                {t("subagentOutput.title")}
              </DialogTitle>
              <p className="truncate text-caption text-muted-foreground" title={selection.taskId}>
                {selection.taskId}
              </p>
            </div>
            <Task collapsible={false} status={toSubagentTaskStatus(selection.status)}>
              <TaskTrigger title={t("subagentOutput.task", { taskId: selection.taskId })} />
            </Task>
            <Button
              aria-label={t("subagentOutput.close")}
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </header>
          <div className="flex min-h-0 flex-col overflow-hidden bg-content">{content}</div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
