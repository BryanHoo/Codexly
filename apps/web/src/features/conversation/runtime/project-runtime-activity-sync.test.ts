import type { AgentEvent, AgentTaskSnapshotResponse } from "@codexly/protocol";
import { expect, test, vi } from "vitest";
import { createProjectRuntimeManager } from "./project-runtime.js";
import { getTaskActivity } from "./task-activity.js";
import type { CodexlyRuntimeClient } from "../../projects/project-queries.js";

test("restores unopened tasks without reading histories and rejects a late snapshot after a local update", () => {
  const readTask = vi.fn();
  const manager = createProjectRuntimeManager({ readTask } as unknown as CodexlyRuntimeClient);
  const baseline = manager.getTaskActivity();
  const task = {
    projectId: "p",
    taskId: "background",
    taskName: "后台任务",
    status: "running" as const,
    requiresApproval: false,
  };
  manager.reconcileTaskActivities([task], baseline);
  expect(getTaskActivity(manager.getTaskActivity(), "p", "background").isRunning).toBe(true);
  const beforeRead = manager.getTaskActivity();
  manager.markTaskRunning("p", "other");
  manager.reconcileTaskActivities([{ ...task, taskId: "other", status: "completed" }], beforeRead);
  expect(getTaskActivity(manager.getTaskActivity(), "p", "other").isRunning).toBe(true);
  expect(readTask).not.toHaveBeenCalled();
  manager.dispose();
});

test("activity checkpoints protect status from older detail reads and repeated snapshots keep reference identity", async () => {
  const { createSnapshotResponse } = await import("./project-runtime.test-support.js");
  const manager = createProjectRuntimeManager({
    subscribeEvents: () => vi.fn(),
  } as unknown as CodexlyRuntimeClient);
  const activity = {
    projectId: "project-1",
    taskId: "background",
    taskName: "后台任务",
    status: "running" as const,
    requiresApproval: false,
    checkpoint: { sessionId: "runtime-1", sequence: 10 },
  };
  manager.reconcileTaskActivities([activity], manager.getTaskActivity());
  const current = manager.getTaskActivity();
  manager.reconcileTaskActivities([activity], current);
  expect(manager.getTaskActivity()).toBe(current);
  manager.observeSnapshot(createSnapshotResponse("background", { status: "idle", sequence: 9 }));
  expect(getTaskActivity(manager.getTaskActivity(), "project-1", "background").isRunning).toBe(
    true,
  );
  manager.dispose();
});

test.each([false, true])(
  "回答后继续输出仍清除等待，且不回退聊天水位（存在审批：%s）",
  async (requiresApproval) => {
    const { getSidebarActiveTasks } = await import("@codexly/frontend-core/sidebar-task-shortcuts");
    let emit: (event: AgentEvent) => void = () => undefined;
    const manager = createProjectRuntimeManager({
      subscribeEvents: (options: { onEvent: typeof emit }) => {
        emit = options.onEvent;
        return () => undefined;
      },
    } as unknown as CodexlyRuntimeClient);
    const task = {
      projectId: "project-1",
      taskId: "task-1",
      taskName: "异步问答",
      status: "waiting" as const,
      requiresApproval,
      checkpoint: { sessionId: "runtime-1", sequence: 5 },
    };
    const response: AgentTaskSnapshotResponse = {
      checkpoint: { sessionId: "runtime-1", sequence: 0 },
      snapshot: {
        id: task.taskId,
        projectId: task.projectId,
        title: task.taskName,
        status: "running",
        contextUsage: null,
        goal: null,
        plan: null,
        pendingRequests: [],
        pinned: false,
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "model",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        turns: [],
        turnsNextCursor: null,
        updatedAt: "2026-10-30T00:00:00Z",
      },
    };
    try {
      manager.observeSnapshot(response);
      manager.reconcileTaskActivities([task], manager.getTaskActivity());
      const baseline = manager.getTaskActivity();
      emit({
        version: 2,
        provider: "codex",
        sessionId: "runtime-1",
        sequence: 6,
        taskId: task.taskId,
        turnId: "turn-1",
        itemId: "reply",
        timestamp: response.snapshot.updatedAt,
        type: "message.delta",
        payload: { delta: "继续执行" },
      });
      // 活动摘要仅在状态变化时推进 checkpoint；处理答案也可以发生在事件流之外。
      manager.reconcileTaskActivities(
        [{ ...task, status: "running", requiresApproval: false }],
        baseline,
      );
      expect(
        getSidebarActiveTasks(manager.getTaskActivity(), new Set([task.projectId])),
      ).toMatchObject({
        approvalCount: 0,
        runningCount: 1,
        tasks: [{ status: "running" }],
      });
      // 较旧详情不能因活动摘要成功合并而重新覆盖运行状态。
      manager.observeSnapshot({
        ...response,
        checkpoint: task.checkpoint,
        snapshot: { ...response.snapshot, status: "idle" },
      });
      expect(
        getTaskActivity(manager.getTaskActivity(), task.projectId, task.taskId).isRunning,
      ).toBe(true);
    } finally {
      manager.dispose();
    }
  },
);
