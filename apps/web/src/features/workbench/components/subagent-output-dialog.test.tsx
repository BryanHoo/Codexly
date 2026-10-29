import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskStore } from "../../conversation/runtime/task-store.js";
import type { ProjectRuntimeManager } from "../../conversation/runtime/project-runtime.js";
import { SubagentOutputDialog } from "./subagent-output-dialog.js";
import { i18n } from "../../../i18n/i18n.js";

const { runtimeMock } = vi.hoisted(() => ({ runtimeMock: vi.fn() }));
vi.mock("../../conversation/runtime/use-task-runtime.js", () => ({ useTaskRuntime: runtimeMock }));
vi.mock("./task-timeline.js", () => ({
  TaskTimeline: () => createElement("div", { "data-legacy-timeline": "" }),
}));

const makeStore = (taskId: string, embedded: boolean) =>
  createTaskStore(
    { projectId: "project", taskId },
    {
      checkpoint: { sequence: 0, sessionId: "session" },
      snapshot: {
        id: taskId,
        projectId: "project",
        title: "研究缓存",
        pinned: false,
        status: "running",
        updatedAt: "2026-10-29T00:00:00Z",
        pendingRequests: [],
        contextUsage: null,
        goal: null,
        plan: null,
        turnsNextCursor: null,
        settings: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "test-model",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
        turns: [
          {
            id: "turn",
            status: "running",
            startedAt: "2026-10-29T00:00:00Z",
            completedAt: null,
            error: null,
            items: embedded
              ? [
                  {
                    id: "spawn",
                    type: "tool",
                    name: "agent/spawn",
                    status: "running",
                    input: { prompt: "检查缓存", model: "test-model" },
                    output: {
                      parentTaskId: "parent",
                      agents: [{ taskId: "child", nickname: "研究员", status: "running" }],
                      turn: {
                        id: "embedded",
                        status: "running",
                        items: [
                          { id: "embedded", type: "message", role: "user", text: "检查缓存" },
                        ],
                      },
                    },
                  },
                ]
              : [
                  { id: "user", type: "message", role: "user", text: "检查缓存" },
                  {
                    id: "read",
                    type: "tool",
                    name: "read_file",
                    status: "completed",
                    output: "cache key",
                  },
                ],
          },
        ],
      },
    },
  );

describe("右栏子代理输出", () => {
  beforeEach(async () => {
    runtimeMock.mockReset();
    await i18n.changeLanguage("zh-CN");
  });
  it.each([false, true])("共用操作详情弹窗与结构化 Trace（内嵌：%s）", (embedded) => {
    const store = makeStore(embedded ? "parent" : "child", embedded);
    runtimeMock.mockReturnValue({
      error: null,
      isPending: false,
      metadata: store.getState().snapshotMetadata,
      store,
      hasOlderHistory: false,
      isLoadingOlderHistory: false,
      olderHistoryError: null,
      loadOlderHistory: vi.fn(),
    });
    const html = renderToStaticMarkup(
      createElement(SubagentOutputDialog, {
        onClose: vi.fn(),
        projectId: "project",
        projectRuntime: {} as ProjectRuntimeManager,
        selection: {
          taskId: "child",
          status: "running",
          ...(embedded ? { embedded: { parentTaskId: "parent", itemId: "spawn" } } : {}),
        },
      }),
    );
    expect(html).toContain("agent-operation-detail-dialog");
    expect(html).toContain('data-subagent-details=""');
    expect(html).toContain('data-subagent-steps=""');
    expect(html).not.toContain("message-scroller-viewport");
    expect(html.match(/检查缓存/gu)).toHaveLength(1);
    expect(runtimeMock.mock.calls[0]?.[1]).toBe(embedded ? "parent" : "child");
  });

  it("独立子线程只渲染最近50条记录，同时保留一次初始任务", () => {
    const initialStore = makeStore("child", false);
    const snapshot = initialStore.getState().reconstructSnapshot();
    if (!snapshot?.turns[0]) throw new Error("Missing fixture turn");
    const initialMessage = snapshot.turns[0].items[0];
    if (!initialMessage) throw new Error("Missing initial message");
    const store = createTaskStore(
      { projectId: "project", taskId: "child" },
      {
        checkpoint: { sequence: 0, sessionId: "session" },
        snapshot: {
          ...snapshot,
          turns: [
            {
              ...snapshot.turns[0],
              items: [
                initialMessage,
                ...Array.from({ length: 60 }, (_, index) => ({
                  id: `step-${String(index)}`,
                  type: "tool" as const,
                  name: `read-${String(index)}`,
                  status: "completed" as const,
                })),
              ],
            },
          ],
        },
      },
    );
    const reconstruct = vi.spyOn(store.getState(), "reconstructSnapshot");
    runtimeMock.mockReturnValue({
      error: null,
      isPending: false,
      metadata: store.getState().snapshotMetadata,
      store,
      hasOlderHistory: false,
    });
    const html = renderToStaticMarkup(
      createElement(SubagentOutputDialog, {
        onClose: vi.fn(),
        projectId: "project",
        projectRuntime: {} as ProjectRuntimeManager,
        selection: { taskId: "child", status: "running" },
      }),
    );
    expect(html.match(/data-slot="trace-collapsible"/gu)).toHaveLength(50);
    expect(html.match(/检查缓存/gu)).toHaveLength(1);
    expect(reconstruct).not.toHaveBeenCalled();
  });

  it("摘要只保留初始任务时仍能打开独立子线程的过程历史", () => {
    const snapshot = makeStore("child", false).getState().reconstructSnapshot();
    const turn = snapshot?.turns[0];
    const initialMessage = turn?.items[0];
    if (!snapshot || !turn || !initialMessage) throw new Error("Missing fixture");
    const store = createTaskStore(
      { projectId: "project", taskId: "child" },
      {
        checkpoint: { sequence: 0, sessionId: "session" },
        snapshot: {
          ...snapshot,
          turns: [{ ...turn, processCursor: "older-process", items: [initialMessage] }],
        },
      },
    );
    runtimeMock.mockReturnValue({
      error: null,
      isPending: false,
      metadata: store.getState().snapshotMetadata,
      store,
      hasOlderHistory: false,
    });
    const html = renderToStaticMarkup(
      createElement(SubagentOutputDialog, {
        onClose: vi.fn(),
        projectId: "project",
        projectRuntime: {} as ProjectRuntimeManager,
        selection: { taskId: "child", status: "running" },
      }),
    );
    expect(html).toContain(i18n.t("timeline.loadMoreProcess", { ns: "conversation" }));
    expect(html.match(/检查缓存/gu)).toHaveLength(1);
  });
});
