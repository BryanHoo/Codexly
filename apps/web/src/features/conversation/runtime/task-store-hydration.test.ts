import { describe, expect, it, vi } from "vitest";
import { createTaskStore } from "./task-store.js";
import {
  timestamp,
  runningItemKey,
  createResponse,
  eventEnvelope,
} from "./task-store.test-support.js";

describe("task store hydration", () => {
  it("prepends older turn pages and preserves them during partial snapshot recovery", () => {
    const olderTurn = {
      completedAt: timestamp,
      error: null,
      id: "turn-older",
      items: [
        {
          id: "shared-page-item",
          role: "assistant" as const,
          text: "更早",
          type: "message" as const,
        },
      ],
      startedAt: timestamp,
      status: "completed" as const,
    };
    const newestTurn = {
      completedAt: timestamp,
      error: null,
      id: "turn-newest",
      items: [
        {
          id: "shared-page-item",
          role: "assistant" as const,
          text: "最新",
          type: "message" as const,
        },
      ],
      startedAt: timestamp,
      status: "completed" as const,
    };
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ turns: [newestTurn], turnsNextCursor: "older-page" }),
    );
    const newestItemStore = store.getState().itemStoresByKey.values().next().value;
    if (newestItemStore === undefined) {
      throw new Error("Expected the newest item store");
    }
    const readSpy = vi.spyOn(newestItemStore, "read");
    const retainedBytesBefore = store.getState().retainedBytes;

    store.getState().prependHistory(createResponse({ turns: [olderTurn], turnsNextCursor: null }));

    expect(readSpy).not.toHaveBeenCalled();
    expect(store.getState().retainedBytes).toBeGreaterThan(retainedBytesBefore);
    expect(store.getState().reconstructSnapshot()).toMatchObject({
      turns: [
        { id: "turn-older", items: [{ id: "shared-page-item", text: "更早" }] },
        { id: "turn-newest", items: [{ id: "shared-page-item", text: "最新" }] },
      ],
      turnsNextCursor: null,
    });

    store
      .getState()
      .reconcile(createResponse({ turns: [newestTurn], turnsNextCursor: "older-page" }));
    expect(store.getState().reconstructSnapshot()).toMatchObject({
      turns: [{ id: "turn-older" }, { id: "turn-newest" }],
      turnsNextCursor: null,
    });
    readSpy.mockRestore();
  });

  it("evicts prepended command output before newer retained output", () => {
    const commandOutput = "x".repeat(1_000_000);
    const currentTurn = {
      completedAt: timestamp,
      error: null,
      id: "turn-current",
      items: Array.from({ length: 8 }, (_, index) => ({
        command: `current-${String(index)}`,
        cwd: "/workspace",
        id: `current-${String(index)}`,
        output: commandOutput,
        outputOmitted: { bytes: 0, lines: 0 },
        status: "completed" as const,
        type: "command" as const,
      })),
      startedAt: timestamp,
      status: "completed" as const,
    };
    const olderTurn = {
      ...currentTurn,
      id: "turn-older-command",
      items: [
        {
          command: "older",
          cwd: "/workspace",
          id: "older-command",
          output: commandOutput,
          outputOmitted: { bytes: 0, lines: 0 },
          status: "completed" as const,
          type: "command" as const,
        },
      ],
    };
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ turns: [currentTurn], turnsNextCursor: "older-page" }),
    );

    store.getState().prependHistory(createResponse({ turns: [olderTurn], turnsNextCursor: null }));

    expect(store.getState().getItem("older-command", "turn-older-command")).toMatchObject({
      outputOmitted: { bytes: commandOutput.length, lines: 0 },
    });
    expect(store.getState().getItem("current-0", "turn-current")).toMatchObject({
      output: commandOutput,
      outputOmitted: { bytes: 0, lines: 0 },
    });
  });

  it("applies native thread status updates to snapshot metadata", () => {
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ status: "idle" }),
    );

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: { status: "running" },
        type: "task.status_updated",
      },
    ]);

    expect(store.getState().snapshotMetadata).toMatchObject({
      status: "running",
      updatedAt: "2026-07-28T00:00:01.000Z",
    });
  });

  it("applies goal updates and clears them from snapshot metadata", () => {
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ goal: null }),
    );
    const goal = {
      createdAt: timestamp,
      objective: "修复 Goal 状态链路",
      status: "active" as const,
      timeUsedSeconds: 8,
      tokenBudget: null,
      tokensUsed: 512,
      updatedAt: timestamp,
    };

    store
      .getState()
      .applyEvents([{ ...eventEnvelope(11), payload: { goal }, type: "goal.updated" }]);
    expect(store.getState().reconstructSnapshot()?.goal).toEqual(goal);

    store.getState().applyEvents([{ ...eventEnvelope(12), payload: {}, type: "goal.cleared" }]);
    expect(store.getState().reconstructSnapshot()?.goal).toBeNull();
  });

  it("applies streamed plan, reasoning sections, tool progress, file changes, and turn diff", () => {
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-running",
            items: [
              { id: "plan-1", text: "", type: "plan" },
              { id: "reasoning-1", content: "raw", summary: "", type: "reasoning" },
              { id: "mcp-1", name: "docs/search", status: "running", type: "tool" },
              { changes: [], id: "patch-1", status: "running", type: "file_change" },
            ],
            startedAt: timestamp,
            status: "running",
          },
        ],
      }),
    );

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "plan-1",
        payload: { delta: "## 计划" },
        turnId: "turn-running",
        type: "plan.delta",
      },
      {
        ...eventEnvelope(12),
        itemId: "reasoning-1",
        payload: { delta: "核对协议", field: "summary", sectionIndex: 0 },
        turnId: "turn-running",
        type: "reasoning.delta",
      },
      {
        ...eventEnvelope(13),
        itemId: "reasoning-1",
        payload: { delta: "检查界面", field: "summary", sectionIndex: 1 },
        turnId: "turn-running",
        type: "reasoning.delta",
      },
      {
        ...eventEnvelope(14),
        itemId: "mcp-1",
        payload: { message: "正在读取资源" },
        turnId: "turn-running",
        type: "tool.progress",
      },
      {
        ...eventEnvelope(15),
        itemId: "patch-1",
        payload: {
          changes: [{ diff: "+const ready = true;", kind: "update", path: "src/app.ts" }],
          originalByteLength: 20,
          truncated: false,
        },
        turnId: "turn-running",
        type: "file_change.updated",
      },
    ]);

    expect(store.getState().getItem("plan-1", "turn-running")).toMatchObject({ text: "## 计划" });
    expect(store.getState().getItem("reasoning-1", "turn-running")).toMatchObject({
      content: "raw",
      summary: "核对协议\n\n检查界面",
    });
    expect(store.getState().getItem("mcp-1", "turn-running")).toMatchObject({
      progress: "正在读取资源",
    });
    expect(store.getState().getItem("patch-1", "turn-running")).toMatchObject({
      changes: [{ path: "src/app.ts" }],
      status: "running",
    });
    const terminalItems = (store.getState().itemKeysByTurnId["turn-running"] ?? []).flatMap(
      (itemId) => {
        const item = store.getState().getItemByKey(itemId);
        return item === undefined ? [] : [item];
      },
    );
    store.getState().applyEvents([
      {
        ...eventEnvelope(16),
        payload: {
          turn: {
            completedAt: timestamp,
            error: null,
            id: "turn-running",
            items: terminalItems,
            startedAt: timestamp,
            status: "completed",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);
  });

  it("tracks reasoning summary sections without materializing previous chunks", () => {
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: [
          {
            completedAt: null,
            error: null,
            id: "turn-running",
            items: [{ content: "", id: "reasoning-1", summary: "既有摘要", type: "reasoning" }],
            startedAt: timestamp,
            status: "running",
          },
        ],
      }),
    );
    const itemStore = store.getState().itemStoresByKey.get(runningItemKey("reasoning-1"));
    if (itemStore === undefined) {
      throw new Error("Expected reasoning item store");
    }
    const readSpy = vi.spyOn(itemStore, "read");

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "reasoning-1",
        payload: { delta: "新增分段", field: "summary", sectionIndex: 1 },
        turnId: "turn-running",
        type: "reasoning.delta",
      },
    ]);

    expect(readSpy).not.toHaveBeenCalled();
    expect(store.getState().getItem("reasoning-1", "turn-running")).toMatchObject({
      summary: "既有摘要\n\n新增分段",
    });
  });

  it("completes one turn without scanning every historical item store", () => {
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({
        turns: Array.from({ length: 100 }, (_, index) => ({
          completedAt: index === 99 ? null : timestamp,
          error: null,
          id: `turn-${String(index)}`,
          items: [
            {
              id: `message-${String(index)}`,
              role: "assistant" as const,
              text: `消息 ${String(index)}`,
              type: "message" as const,
            },
          ],
          startedAt: timestamp,
          status: index === 99 ? ("running" as const) : ("completed" as const),
        })),
      }),
    );
    const keys = vi.spyOn(store.getState().itemStoresByKey, "keys").mockImplementation(() => {
      throw new Error("turn completion must not scan all item stores");
    });

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: {
          turn: {
            completedAt: timestamp,
            error: null,
            id: "turn-99",
            items: [
              {
                id: "message-99",
                role: "assistant",
                text: "完成",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "completed",
          },
        },
        turnId: "turn-99",
        type: "turn.completed",
      },
    ]);

    expect(store.getState().getItem("message-99", "turn-99")).toMatchObject({ text: "完成" });
    expect(keys).not.toHaveBeenCalled();
  });

  it("retains only the latest task notices", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents(
      Array.from({ length: 25 }, (_, index) => ({
        ...eventEnvelope(11 + index),
        payload: {
          code: "runtime_warning" as const,
          level: "warning" as const,
          message: `警告 ${String(index)}`,
        },
        type: "task.notice" as const,
      })),
    );

    expect(store.getState().notices).toHaveLength(20);
    expect(store.getState().notices[0]?.payload.message).toBe("警告 5");
    expect(store.getState().notices.at(-1)?.payload.message).toBe("警告 24");
  });

  it("clears transient task notices when the active turn completes", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: {
          code: "runtime_warning",
          level: "warning",
          message: "Runtime warning during streaming",
        },
        type: "task.notice",
      },
      {
        ...eventEnvelope(12),
        payload: {
          turn: {
            completedAt: timestamp,
            error: null,
            id: "turn-running",
            items: [
              {
                id: "message-running",
                role: "assistant",
                text: "已完成",
                type: "message",
              },
            ],
            startedAt: timestamp,
            status: "completed",
          },
        },
        turnId: "turn-running",
        type: "turn.completed",
      },
    ]);

    expect(store.getState().notices).toEqual([]);
  });

  it("does not retain guardian warnings duplicated by approval review items", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: {
          code: "guardian_warning",
          level: "warning",
          message: "Automatic approval review approved",
        },
        type: "task.notice",
      },
      {
        ...eventEnvelope(12),
        payload: {
          code: "runtime_warning",
          level: "warning",
          message: "Runtime remains unavailable",
        },
        type: "task.notice",
      },
    ]);

    expect(store.getState().notices).toMatchObject([
      {
        payload: {
          code: "runtime_warning",
          message: "Runtime remains unavailable",
        },
      },
    ]);
  });

  it("replaces the latest plan without rebuilding timeline item state", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const previousItemIdsByTurnId = store.getState().itemKeysByTurnId;
    const previousItemStoresById = store.getState().itemStoresByKey;

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        payload: {
          plan: {
            explanation: "先完成运行态，再接入界面。",
            steps: [
              { status: "completed", text: "定义协议" },
              { status: "in_progress", text: "合并运行态" },
              { status: "pending", text: "接入界面" },
            ],
          },
        },
        turnId: "turn-running",
        type: "plan.updated",
      },
      {
        ...eventEnvelope(12),
        payload: {
          plan: {
            explanation: null,
            steps: [
              { status: "completed", text: "定义协议" },
              { status: "completed", text: "合并运行态" },
              { status: "in_progress", text: "接入界面" },
            ],
          },
        },
        turnId: "turn-running",
        type: "plan.updated",
      },
    ]);

    expect(store.getState().reconstructSnapshot()?.plan).toEqual({
      explanation: null,
      steps: [
        { status: "completed", text: "定义协议" },
        { status: "completed", text: "合并运行态" },
        { status: "in_progress", text: "接入界面" },
      ],
    });
    expect(store.getState().itemKeysByTurnId).toBe(previousItemIdsByTurnId);
    expect(store.getState().itemStoresByKey).toBe(previousItemStoresById);
    expect(store.getState().checkpoint?.sequence).toBe(12);
  });
});
