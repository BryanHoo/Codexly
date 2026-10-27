import { StrictMode } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import { TaskEventTarget } from "../../conversation/runtime/project-runtime-recovery.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskStoreTimeline } from "./task-timeline-store.js";
import { createProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import type { NativeRuntimeClient } from "../../projects/project-queries.js";
import type { SubscribeAgentEventsOptions } from "../../../platform/native-client-types.js";
import type { AgentTaskSnapshotResponse } from "../../../protocol/index.js";

function splitTaskSnapshot(taskId: string): AgentTaskSnapshotResponse {
  return {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: taskId, projectId: "project", title: taskId, pinned: false,
      updatedAt: "2026-10-27T00:00:00Z", status: "idle", pendingRequests: [],
      turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model", reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [],
    },
  };
}

it("flushes a batched preamble before showing a command in the live timeline", async () => {
  const full = "我会检查服务器上的升级、重启脚本，确认它们是否会覆盖刚修改的参数。";
  const store = createTaskStore({ projectId: "project", taskId: "task" }, {
    checkpoint: { sequence: 0, sessionId: "session" },
    snapshot: {
      id: "task", projectId: "project", title: "Task", pinned: false,
      updatedAt: "2026-10-27T00:00:01Z", status: "running", pendingRequests: [],
      turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
      settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model", reasoningEffort: "high", sandboxMode: "workspace-write" },
      turns: [{ id: "turn", status: "running", startedAt: "2026-10-27T00:00:00Z", completedAt: null, error: null, items: [] }],
    },
  });
  const target = new TaskEventTarget(store, async () => undefined, () => undefined);
  const screen = await render(<StrictMode><TooltipProvider><div style={{height: 600, width: 800}}><TaskStoreTimeline connected store={store} onOpenFileDiff={() => undefined} onOpenSourceFile={() => undefined} onReviewFileChanges={() => undefined} onResolvePendingRequest={async () => undefined} /></div></TooltipProvider></StrictMode>);
  const base = { version: 2 as const, provider: "codex", sessionId: "session", taskId: "task", turnId: "turn", timestamp: "2026-10-27T00:00:02Z" };
  try {
    // 先显示首字，再连续交付尾部、完成和命令事件，验证文字转为静态后仍能完整展示。
    target.apply({ ...base, sequence: 1, itemId: "reply", type: "message.delta", payload: { delta: "我" } });
    await expect.element(screen.getByText("我", { exact: true })).toBeVisible();
    target.apply({ ...base, sequence: 2, itemId: "reply", type: "message.delta", payload: { delta: full.slice(1) } });
    target.apply({ ...base, sequence: 3, itemId: "reply", type: "item.completed", payload: { item: { id: "reply", type: "message", role: "assistant", text: full } } });
    target.apply({ ...base, sequence: 4, itemId: "command", type: "item.started", payload: { item: { id: "command", type: "command", command: "ssh server", cwd: "/tmp", status: "running", outputOmitted: { bytes: 0, lines: 0 } } } });
    expect(store.getState().getItem("reply", "turn")).toMatchObject({ text: full });
    await expect.element(screen.getByText(full, { exact: true })).toBeVisible();
  } finally {
    target.dispose();
  }
});

it("分屏保持挂载时，新消息首字仍触发快照同步且迟到快照不能截断正文", async () => {
  const left = splitTaskSnapshot("left-task");
  const right = splitTaskSnapshot("right-task");
  const leftStore = createTaskStore({ projectId: "project", taskId: "left-task" }, left);
  const rightStore = createTaskStore({ projectId: "project", taskId: "right-task" }, right);
  let resolveSnapshot!: (response: AgentTaskSnapshotResponse) => void;
  const pending = new Promise<AgentTaskSnapshotResponse>((resolve) => { resolveSnapshot = resolve; });
  let emit: SubscribeAgentEventsOptions["onEvent"] = () => { throw new Error("尚未连接事件流"); };
  const client: NativeRuntimeClient = {
    readTask: vi.fn(() => pending),
    retainTaskSubscription: vi.fn(async () => undefined),
    releaseTaskSubscription: vi.fn(async () => undefined),
    subscribeEvents: vi.fn((options: SubscribeAgentEventsOptions) => {
      emit = options.onEvent;
      options.onConnectionState?.("connected");
      return () => undefined;
    }),
  };
  let synchronization: Promise<AgentTaskSnapshotResponse> | undefined;
  const runtime = createProjectRuntimeManager(client, {
    onTaskMetadataChanged(projectId, taskId, reason) {
      // 对应 ProjectProvider 的真实首字元数据同步分支：它会读取并回写 Snapshot，无须导航。
      if (reason === "assistant_reply_started") synchronization = runtime.refreshTaskSnapshot(projectId, taskId);
    },
  });
  const viewTask = vi.spyOn(runtime, "viewTask");
  const detachLeft = runtime.attachTaskStore(left, leftStore, async () => undefined);
  const detachRight = runtime.attachTaskStore(right, rightStore, async () => undefined);
  runtime.viewTask("project", "left-task");
  const actions = { onOpenFileDiff: () => undefined, onOpenSourceFile: () => undefined, onReviewFileChanges: () => undefined, onResolvePendingRequest: async () => undefined };
  const screen = await render(<StrictMode><TooltipProvider><div style={{ display: "flex", height: 600, width: 1200 }}>
    <section aria-label="左侧分屏" style={{ display: "flex", width: 600 }}><TaskStoreTimeline connected store={leftStore} {...actions} /></section>
    <section aria-label="右侧分屏" style={{ display: "flex", width: 600 }}><TaskStoreTimeline connected store={rightStore} {...actions} /></section>
  </div></TooltipProvider></StrictMode>);
  const panes = Array.from(screen.container.querySelectorAll("section[aria-label$='分屏']"));
  const base = { version: 2 as const, provider: "codex", sessionId: "session", taskId: "left-task", turnId: "new-turn", timestamp: "2026-10-27T00:00:02Z" };
  const full = "我会检查配置并执行命令。";
  try {
    // 已有分屏内发送新消息，不切换任务；首字就会启动后台快照读取。
    emit({ ...base, sequence: 1, type: "turn.started", payload: { turn: { id: "new-turn", status: "running", startedAt: base.timestamp, completedAt: null, error: null, items: [{ id: "user", type: "message", role: "user", text: "检查配置" }] } } });
    emit({ ...base, sequence: 2, itemId: "reply", type: "message.delta", payload: { delta: "我" } });
    await expect.element(screen.getByText("我", { exact: true })).toBeVisible();
    expect(client.readTask).toHaveBeenCalledExactlyOnceWith("project", "left-task", { summary: true });
    const captured: AgentTaskSnapshotResponse = { checkpoint: { sessionId: "session", sequence: 2 }, snapshot: { ...leftStore.getState().reconstructSnapshot()!, pendingRequests: [] } };
    emit({ ...base, sequence: 3, itemId: "reply", type: "message.delta", payload: { delta: full.slice(1) } });
    emit({ ...base, sequence: 4, itemId: "reply", type: "item.completed", payload: { item: { id: "reply", type: "message", role: "assistant", text: full } } });
    emit({ ...base, sequence: 5, itemId: "command", type: "item.started", payload: { item: { id: "command", type: "command", command: "pwd", cwd: "/tmp", status: "running", outputOmitted: { bytes: 0, lines: 0 } } } });
    // 迟到的首字快照仅覆盖至序号 2；原生一致性保护禁止将它误标成包含序号 3..5。
    resolveSnapshot(captured);
    await synchronization;
    await expect.element(screen.getByText(full, { exact: true })).toBeVisible();
    expect(leftStore.getState().getItem("reply", "new-turn")).toMatchObject({ text: full });
    expect(rightStore.getState().turnIds).toEqual([]);
    const finalPanes = screen.container.querySelectorAll("section[aria-label$='分屏']");
    expect(finalPanes[0]).toBe(panes[0]);
    expect(finalPanes[1]).toBe(panes[1]);
    expect(viewTask).toHaveBeenCalledExactlyOnceWith("project", "left-task");
    expect(client.subscribeEvents).toHaveBeenCalledOnce();
  } finally {
    detachLeft();
    detachRight();
    runtime.dispose();
  }
});
