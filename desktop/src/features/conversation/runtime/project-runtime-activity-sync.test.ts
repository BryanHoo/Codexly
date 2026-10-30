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
