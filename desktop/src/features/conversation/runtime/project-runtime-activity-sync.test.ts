import type { AgentEvent, AgentTaskSnapshotResponse } from "../../../protocol/index.js";
import { expect, test, vi } from "vitest";
import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { getTaskActivity } from "./task-activity.js";

test("reconciles unopened native tasks and preserves newer local changes without reading history", () => {
  const readTask = vi.fn();
  const runtime = createProjectRuntimeManager({ readTask } as unknown as NativeRuntimeClient);
  const task = { projectId: "p", taskId: "t", taskName: "后台任务", status: "running" as const, requiresApproval: false };
  runtime.reconcileTaskActivities([task], runtime.getTaskActivity());
  expect(getTaskActivity(runtime.getTaskActivity(), "p", "t").isRunning).toBe(true);
  runtime.reconcileTaskActivities([{ ...task, status: "completed" }], runtime.getTaskActivity());
  expect(getTaskActivity(runtime.getTaskActivity(), "p", "t")).toMatchObject({ isRunning: false, attention: "completed" });
  const beforeRead = runtime.getTaskActivity();
  runtime.markTaskRunning("p", "t");
  runtime.reconcileTaskActivities([{ ...task, status: "failed" }], beforeRead);
  expect(getTaskActivity(runtime.getTaskActivity(), "p", "t").isRunning).toBe(true);
  expect(readTask).not.toHaveBeenCalled();
  runtime.dispose();
});


test.each([false, true])("回答后继续输出仍清除等待，且不回退聊天水位（存在审批：%s）", async (requiresApproval) => {
  const { getSidebarActiveTasks } = await import("@codexly/frontend-core/sidebar-task-shortcuts");
  let emit: (event: AgentEvent) => void = () => undefined;
  const manager = createProjectRuntimeManager({
    subscribeEvents: (options: { onEvent: typeof emit }) => { emit = options.onEvent; return () => undefined; },
  } as unknown as NativeRuntimeClient);
  const task = {
    projectId: "project-1", taskId: "task-1", taskName: "异步问答",
    status: "waiting" as const, requiresApproval,
    checkpoint: { sessionId: "runtime-1", sequence: 5 },
  };
  const response: AgentTaskSnapshotResponse = {
    checkpoint: { sessionId: "runtime-1", sequence: 0 },
    snapshot: {
      id: task.taskId, projectId: task.projectId, title: task.taskName, status: "running",
      contextUsage: null, goal: null, plan: null, pendingRequests: [], pinned: false,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model", reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [], turnsNextCursor: null, updatedAt: "2026-10-30T00:00:00Z",
    },
  };
  try {
    manager.observeSnapshot(response);
    manager.reconcileTaskActivities([task], manager.getTaskActivity());
    const baseline = manager.getTaskActivity();
    emit({
      version: 2, provider: "codex", sessionId: "runtime-1", sequence: 6,
      taskId: task.taskId, turnId: "turn-1", itemId: "reply", timestamp: response.snapshot.updatedAt,
      type: "message.delta", payload: { delta: "继续执行" },
    });
    // 活动摘要仅在状态变化时推进 checkpoint；处理答案也可以发生在事件流之外。
    manager.reconcileTaskActivities([{ ...task, status: "running", requiresApproval: false }], baseline);
    expect(getSidebarActiveTasks(manager.getTaskActivity(), new Set([task.projectId]))).toMatchObject({
      approvalCount: 0, runningCount: 1, tasks: [{ status: "running" }],
    });
    // 较旧详情不能因活动摘要成功合并而重新覆盖运行状态。
    manager.observeSnapshot({ ...response, checkpoint: task.checkpoint, snapshot: { ...response.snapshot, status: "idle" } });
    expect(getTaskActivity(manager.getTaskActivity(), task.projectId, task.taskId).isRunning).toBe(true);
  } finally { manager.dispose(); }
});

test.each(["completed", "interrupted", "failed"] as const)(
  "离开任务后迟到摘要不恢复已查看的 %s 提醒，新回合仍会提醒",
  (status) => {
    let emit: (event: AgentEvent) => void = () => undefined;
    const runtime = createProjectRuntimeManager({
      subscribeEvents: (options: { onEvent: typeof emit }) => {
        emit = options.onEvent;
        return () => undefined;
      },
    } as unknown as NativeRuntimeClient);
    const acknowledge = vi.fn();
    runtime.onTaskActivityViewed = acknowledge;
    const task = {
      projectId: "project-1", taskId: "task-1", taskName: "任务",
      status: status === "completed" ? "completed" as const : "failed" as const,
      requiresApproval: false, version: 1,
      checkpoint: { sessionId: "runtime-1", sequence: 1 },
    };
    const event: AgentEvent = {
      type: "turn.completed", version: 2, provider: "codex", sessionId: "runtime-1",
      sequence: 1, taskId: task.taskId, turnId: "turn-1", timestamp: "2026-10-30T00:00:01Z",
      payload: { turn: { id: "turn-1", status, startedAt: null, completedAt: null, items: [], error: null } },
    };
    try {
      const close = runtime.observeVisibleTask(task.projectId, task.taskId);
      runtime.reconcileTaskActivities([{ ...task, status: "running", checkpoint: { ...task.checkpoint, sequence: 0 } }], runtime.getTaskActivity());
      runtime.markTaskRunning(task.projectId, task.taskId);
      // 通过普通会话快照建立项目事件订阅。
      runtime.observeSnapshot({
        checkpoint: { ...task.checkpoint, sequence: 0 },
        snapshot: {
          id: task.taskId, projectId: task.projectId, title: task.taskName, status: "running",
          contextUsage: null, goal: null, plan: null, pendingRequests: [], pinned: false,
          settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model", reasoningEffort: "high", sandboxMode: "workspace-write" },
          turns: [], turnsNextCursor: null, updatedAt: event.timestamp,
        },
      });
      emit(event);
      expect(getTaskActivity(runtime.getTaskActivity(), task.projectId, task.taskId)).toMatchObject({ attention: null, isRunning: false });
      close();
      runtime.viewTask(task.projectId, "other");
      runtime.reconcileTaskActivities([task], runtime.getTaskActivity());
      expect(getTaskActivity(runtime.getTaskActivity(), task.projectId, task.taskId).attention).toBeNull();
      expect(acknowledge).toHaveBeenCalledWith(task.projectId, task.taskId, task.checkpoint.sequence);
      runtime.reconcileTaskActivities([{ ...task, version: 2, checkpoint: { ...task.checkpoint, sequence: 3 } }], runtime.getTaskActivity());
      expect(getTaskActivity(runtime.getTaskActivity(), task.projectId, task.taskId).attention).toBe(task.status);
    } finally {
      runtime.dispose();
    }
  },
);
