import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { getTaskActivity } from "../../conversation/runtime/task-activity.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import {
  useCompletedTasks,
  useProjectActivity,
  useProjectData,
} from "../../projects/project-context.js";
import { useAllProjectTodos } from "../project-todo-context.js";
import { groupTaskBoardTasks } from "../task-board-state.js";
import { TaskBoard } from "./task-board.js";

export function TaskBoardContainer({ projectId }: Readonly<{ projectId: string }>) {
  const navigate = useNavigate();
  const { projects } = useProjectData();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const todos = useAllProjectTodos(projectIds);
  const completedQuery = useCompletedTasks(selectedProjectId);
  const { taskActivity } = useProjectActivity();
  const groups = useMemo(() => groupTaskBoardTasks(taskActivity, null), [taskActivity]);
  const completedTasks = useMemo(() => {
    const activeTaskKeys = new Set(
      [...groups.approval, ...groups.running].map((task) => `${task.projectId}\u0000${task.id}`),
    );
    return completedQuery.tasks.filter(
      (task) => !activeTaskKeys.has(`${task.projectId}\u0000${task.id}`),
    );
  }, [completedQuery.tasks, groups.approval, groups.running]);

  useEffect(() => {
    if (completedQuery.error === null) return;
    // 已完成任务是独立数据源，失败只降级对应列，不影响 Runtime 连接状态。
    recordInternalWarning("task_board_completed_tasks_failed", completedQuery.error, {
      projectId: selectedProjectId,
    });
  }, [completedQuery.error, selectedProjectId]);

  return (
    <TaskBoard
      approval={groups.approval}
      completed={completedTasks}
      completedError={completedQuery.error !== null}
      hasNextCompletedPage={completedQuery.hasNextPage}
      isCompletedPending={completedQuery.isPending}
      isLoadingMoreCompleted={completedQuery.isFetchingNextPage}
      isTaskUnviewed={(taskProjectId, taskId) =>
        getTaskActivity(taskActivity, taskProjectId, taskId).attention === "completed"
      }
      onCreateTask={(selectedId) => {
        const targetProjectId = selectedId ?? projectId;
        void (targetProjectId === TEMPORARY_TASK_SCOPE_ID
          ? navigate({ to: "/temporary" })
          : navigate({ params: { projectId: targetProjectId }, to: "/p/$projectId" }));
      }}
      onLoadMoreCompleted={async () => {
        await completedQuery.fetchNextPage();
      }}
      onOpenTask={(task) => {
        void navigate({
          params: { projectId: task.projectId, taskId: task.id },
          to: "/p/$projectId/t/$taskId",
        });
      }}
      onOpenTodo={(todo) => {
        void navigate({
          params: { projectId: todo.projectId, todoId: todo.record.id },
          to: "/p/$projectId/todo/$todoId",
        });
      }}
      onProjectFilterChange={setSelectedProjectId}
      onRetryCompleted={() => void completedQuery.refetch()}
      projects={projects}
      running={groups.running}
      selectedProjectId={selectedProjectId}
      todos={todos}
    />
  );
}
