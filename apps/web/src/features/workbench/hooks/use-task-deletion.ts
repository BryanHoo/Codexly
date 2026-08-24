import { TEMPORARY_TASK_SCOPE_ID, type AgentTask } from "@code-agent/protocol";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import type { AsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { removeRetainedTaskRuntime } from "../../conversation/runtime/use-task-runtime.js";
import { useProjectActions, useProjectData } from "../../projects/project-context.js";
import {
  removeArchivedProjectTaskAndRefill,
  taskDeleteMutationOptions,
} from "../../projects/project-queries.js";

type UseTaskDeletionOptions = Readonly<{
  actionLock: AsyncActionLock;
  activeProjectId: string | undefined;
  activeTaskId: string | undefined;
}>;

export function useTaskDeletion({
  actionLock,
  activeProjectId,
  activeTaskId,
}: UseTaskDeletionOptions) {
  const { client } = useProjectData();
  const { forgetTask } = useProjectActions();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deletingTask, setDeletingTask] = useState<AgentTask | null>(null);
  const deleteMutation = useMutation(taskDeleteMutationOptions(client));

  const confirmTaskDeletion = () => {
    const task = deletingTask;
    if (task === null) return Promise.resolve(undefined);

    return actionLock.run(async () => {
      try {
        await deleteMutation.mutateAsync({ projectId: task.projectId, taskId: task.id });
        setDeletingTask(null);

        // Provider 已完成永久删除，本地清理不得因列表重新校准失败而中断。
        await removeArchivedProjectTaskAndRefill(queryClient, task.projectId, task.id).catch(
          () => undefined,
        );
        queryClient.removeQueries({
          exact: true,
          queryKey: ["projects", task.projectId, "tasks", task.id],
        });
        forgetTask(task.projectId, task.id);
        removeRetainedTaskRuntime(task.projectId, task.id);

        if (task.projectId === activeProjectId && task.id === activeTaskId) {
          await (task.projectId === TEMPORARY_TASK_SCOPE_ID
            ? navigate({ to: "/temporary" })
            : navigate({ params: { projectId: task.projectId }, to: "/p/$projectId" }));
        }

        void client.unsubscribeTask(task.projectId, task.id).catch(() => undefined);
      } catch {
        // 根级 MutationCache 已展示 Provider 原始错误，保留 Dialog 供用户重试。
      }
    });
  };

  return {
    closeTaskDeletion: () => {
      if (!deleteMutation.isPending) setDeletingTask(null);
    },
    confirmTaskDeletion,
    deletingTask,
    isDeletePending: deleteMutation.isPending,
    requestTaskDeletion: setDeletingTask,
  };
}
