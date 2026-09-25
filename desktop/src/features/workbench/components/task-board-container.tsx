import { TEMPORARY_TASK_SCOPE_ID } from "@/protocol/index.js";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { getTaskActivity } from "../../conversation/runtime/task-activity.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import {
  useCompletedTasks,
  useProjectActivity,
  useProjectData,
} from "../../projects/project-context.js";
import { useAllProjectDrafts } from "../project-draft-context.js";
import { groupTaskBoardTasks } from "../task-board-state.js";
import { TaskBoard } from "./task-board.js";

export function TaskBoardContainer({ projectId }: Readonly<{ projectId: string }>) {
  const navigate = useNavigate();
  const { projects } = useProjectData();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const drafts = useAllProjectDrafts(projectIds);
  const completedQuery = useCompletedTasks(selectedProjectId);
  const { taskActivity } = useProjectActivity();
  // 任务生命周期只消费 Rust 活动态投影，WebView 不维护第二套可写状态。
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
    // 已完成列表是看板的独立数据源，失败只能降级对应列，不能误判整个 Codex Runtime。
    recordInternalWarning("task_board_completed_tasks_failed", completedQuery.error, {
      projectId: selectedProjectId,
    });
  }, [completedQuery.error, selectedProjectId]);

  return (
    <TaskBoard
      completed={completedTasks}
      completedError={completedQuery.error !== null}
      drafts={drafts}
      hasNextCompletedPage={completedQuery.hasNextPage}
      isCompletedPending={completedQuery.isPending}
      isLoadingMoreCompleted={completedQuery.isFetchingNextPage}
      isTaskUnviewed={(taskProjectId, taskId) =>
        getTaskActivity(taskActivity, taskProjectId, taskId).attention === "completed"
      }
      onCreateTask={(selectedProjectId) => {
        const targetProjectId = selectedProjectId ?? projectId;
        void (targetProjectId === TEMPORARY_TASK_SCOPE_ID
          ? navigate({ to: "/temporary" })
          : navigate({ params: { projectId: targetProjectId }, to: "/p/$projectId" }));
      }}
      onLoadMoreCompleted={async () => {
        await completedQuery.fetchNextPage();
      }}
      onOpenDraft={({ projectId: draftProjectId, record }) => {
        void navigate({
          params: { draftId: record.id, projectId: draftProjectId },
          to: "/p/$projectId/todo/$draftId",
        });
      }}
      onOpenTask={(task) => {
        void navigate({
          params: { projectId: task.projectId, taskId: task.id },
          to: "/p/$projectId/t/$taskId",
        });
      }}
      onProjectFilterChange={setSelectedProjectId}
      onRetryCompleted={() => {
        void completedQuery.refetch();
      }}
      approval={groups.approval}
      projects={projects}
      running={groups.running}
      selectedProjectId={selectedProjectId}
    />
  );
}
