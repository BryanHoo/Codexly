import { describe, expect, it, vi } from "vitest";
import { createTaskStore, createTaskItemKey } from "./task-store.js";
import {
  timestamp,
  runningItemKey,
  readTurnItemIds,
  createResponse,
  eventEnvelope,
  createPendingRequest,
} from "./task-store.test-support.js";

describe("task store reconciliation", () => {
  it("normalizes hydration and reconstructs a compatibility snapshot", () => {
    const pendingRequest = createPendingRequest();
    const response = createResponse({ pendingRequests: [pendingRequest] });
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" });

    store.getState().hydrate(response);
    const state = store.getState();

    expect(state.turnIds).toEqual(["turn-completed", "turn-running"]);
    expect(state.turnsById["turn-running"]).not.toHaveProperty("items");
    expect(readTurnItemIds(store, "turn-running")).toEqual(["message-running"]);
    expect(state.getItem("message-running", "turn-running")).toMatchObject({ text: "开始" });
    expect(state.pendingRequestIds).toEqual(["request-1"]);
    expect(state.pendingRequestsById["request-1"]).toBe(pendingRequest);
    expect(state.reconstructSnapshot()).toEqual(response.snapshot);
  });

  it("removes turns that are absent from a reconciled authoritative snapshot", () => {
    const initialResponse = createResponse();
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, initialResponse);
    const completedTurn = initialResponse.snapshot.turns[0];
    if (completedTurn === undefined) {
      throw new Error("Expected a completed turn fixture");
    }

    store.getState().reconcile(
      createResponse({
        status: "idle",
        turns: [completedTurn],
      }),
    );

    expect(store.getState().turnIds).toEqual(["turn-completed"]);
    expect(store.getState().turnsById["turn-running"]).toBeUndefined();
    expect(store.getState().getItem("message-running", "turn-running")).toBeUndefined();
  });

  it("invalidates reconstructed snapshots when reconcile removes an optimistic running turn", () => {
    const initialResponse = createResponse();
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, initialResponse);
    const completedTurn = initialResponse.snapshot.turns[0];
    if (completedTurn === undefined) {
      throw new Error("Expected a completed turn fixture");
    }
    const previousStructureRevision = store.getState().itemStructureRevision;

    // Task 元数据仍为 running 时，结构修订号是父级发现临时 Snapshot 缺失 Turn 的唯一信号。
    store.getState().reconcile(createResponse({ turns: [completedTurn] }));

    expect(store.getState().turnIds).toEqual(["turn-completed"]);
    expect(store.getState().itemStructureRevision).toBeGreaterThan(previousStructureRevision);
  });

  it("reconciles synthetic snapshot message ids with their realtime items", () => {
    const liveTurn = {
      completedAt: null,
      error: null,
      id: "turn-running",
      items: [
        {
          id: "realtime-user-id",
          role: "user" as const,
          text: "执行检查",
          type: "message" as const,
        },
        {
          id: "realtime-assistant-id",
          role: "assistant" as const,
          text: "正在",
          type: "message" as const,
        },
      ],
      startedAt: timestamp,
      status: "running" as const,
    };
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ turns: [liveTurn] }),
    );

    store.getState().reconcile(
      createResponse({
        turns: [
          {
            ...liveTurn,
            items: [
              {
                id: "item-1",
                role: "user",
                skills: [{ name: "superwork:superwork-start" }],
                text: "执行检查",
                type: "message",
              },
              {
                id: "item-2",
                role: "assistant",
                text: "正在处理",
                type: "message",
              },
            ],
          },
        ],
      }),
    );

    expect(readTurnItemIds(store, "turn-running")).toEqual([
      "realtime-user-id",
      "realtime-assistant-id",
    ]);
    expect(store.getState().getItem("realtime-user-id", "turn-running")).toMatchObject({
      skills: [{ name: "superwork:superwork-start" }],
    });
    expect(store.getState().getItem("item-1", "turn-running")).toBeUndefined();
    expect(store.getState().getItem("item-2", "turn-running")).toBeUndefined();

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "realtime-assistant-id",
        payload: { delta: "完成" },
        turnId: "turn-running",
        type: "message.delta",
      },
    ]);

    expect(store.getState().getItem("realtime-assistant-id", "turn-running")).toMatchObject({
      text: "正在处理完成",
    });
  });

  it("matches later commentary after unmatched and omitted snapshot messages", () => {
    const liveTurn = {
      completedAt: null,
      error: null,
      id: "turn-running",
      items: [
        {
          id: "realtime-commentary-first",
          role: "assistant" as const,
          text: "先读取配置",
          type: "message" as const,
        },
        {
          id: "realtime-commentary-omitted",
          role: "assistant" as const,
          text: "仅实时可见",
          type: "message" as const,
        },
        {
          id: "realtime-commentary-last",
          role: "assistant" as const,
          text: "再运行检查",
          type: "message" as const,
        },
      ],
      startedAt: timestamp,
      status: "running" as const,
    };
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ turns: [liveTurn] }),
    );

    store.getState().reconcile(
      createResponse({
        turns: [
          {
            ...liveTurn,
            items: [
              {
                id: "snapshot-commentary-first",
                role: "assistant",
                text: "先读取配置完成",
                type: "message",
              },
              {
                id: "snapshot-only-commentary",
                role: "assistant",
                text: "仅 Snapshot 可见",
                type: "message",
              },
              {
                id: "snapshot-commentary-last",
                role: "assistant",
                text: "再运行检查完成",
                type: "message",
              },
            ],
          },
        ],
      }),
    );

    expect(readTurnItemIds(store, "turn-running")).toEqual([
      "realtime-commentary-first",
      "realtime-commentary-omitted",
      "realtime-commentary-last",
      "snapshot-only-commentary",
    ]);

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "realtime-commentary-last",
        payload: { delta: "，全部通过" },
        turnId: "turn-running",
        type: "message.delta",
      },
    ]);

    expect(store.getState().getItem("realtime-commentary-last", "turn-running")).toMatchObject({
      text: "再运行检查完成，全部通过",
    });
  });

  it("does not reconcile empty, duplicate, or ambiguous prefix message text", () => {
    const liveTurn = {
      completedAt: null,
      error: null,
      id: "turn-running",
      items: [
        {
          id: "realtime-empty",
          role: "assistant" as const,
          text: "",
          type: "message" as const,
        },
        {
          id: "realtime-duplicate-first",
          role: "assistant" as const,
          text: "重复内容",
          type: "message" as const,
        },
        {
          id: "realtime-duplicate-last",
          role: "assistant" as const,
          text: "重复内容",
          type: "message" as const,
        },
        {
          id: "realtime-prefix-short",
          role: "assistant" as const,
          text: "前缀",
          type: "message" as const,
        },
        {
          id: "realtime-prefix-long",
          role: "assistant" as const,
          text: "前缀扩展",
          type: "message" as const,
        },
      ],
      startedAt: timestamp,
      status: "running" as const,
    };
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ turns: [liveTurn] }),
    );

    store.getState().reconcile(
      createResponse({
        turns: [
          {
            ...liveTurn,
            items: [
              {
                id: "snapshot-empty",
                role: "assistant",
                text: "",
                type: "message",
              },
              {
                id: "snapshot-duplicate",
                role: "assistant",
                text: "重复内容已完成",
                type: "message",
              },
              {
                id: "snapshot-prefix",
                role: "assistant",
                text: "前缀扩展完成",
                type: "message",
              },
            ],
          },
        ],
      }),
    );

    expect(readTurnItemIds(store, "turn-running")).toEqual([
      "realtime-empty",
      "realtime-duplicate-first",
      "realtime-duplicate-last",
      "realtime-prefix-short",
      "realtime-prefix-long",
      "snapshot-empty",
      "snapshot-duplicate",
      "snapshot-prefix",
    ]);

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "realtime-duplicate-last",
        payload: { delta: "，实时继续" },
        turnId: "turn-running",
        type: "message.delta",
      },
    ]);

    expect(store.getState().getItem("realtime-duplicate-last", "turn-running")).toMatchObject({
      text: "重复内容，实时继续",
    });
    expect(store.getState().getItem("snapshot-duplicate", "turn-running")).toMatchObject({
      text: "重复内容已完成",
    });
  });

  it("reconciles multiple steer user messages by unique text", () => {
    const liveTurn = {
      completedAt: null,
      error: null,
      id: "turn-running",
      items: [
        {
          id: "realtime-user-initial",
          role: "user" as const,
          text: "检查项目",
          type: "message" as const,
        },
        {
          id: "realtime-user-steer-first",
          role: "user" as const,
          text: "继续检查配置",
          type: "message" as const,
        },
        {
          id: "realtime-user-steer-last",
          role: "user" as const,
          text: "补充测试",
          type: "message" as const,
        },
      ],
      startedAt: timestamp,
      status: "running" as const,
    };
    const store = createTaskStore(
      { projectId: "project-1", taskId: "task-1" },
      createResponse({ turns: [liveTurn] }),
    );

    store.getState().reconcile(
      createResponse({
        turns: [
          {
            ...liveTurn,
            items: [
              {
                id: "snapshot-user-initial",
                role: "user",
                skills: [{ name: "initial-skill" }],
                text: "检查项目",
                type: "message",
              },
              {
                id: "snapshot-user-steer-first",
                role: "user",
                skills: [{ name: "steer-first-skill" }],
                text: "继续检查配置",
                type: "message",
              },
              {
                id: "snapshot-user-steer-last",
                role: "user",
                skills: [{ name: "steer-last-skill" }],
                text: "补充测试覆盖",
                type: "message",
              },
            ],
          },
        ],
      }),
    );

    expect(readTurnItemIds(store, "turn-running")).toEqual([
      "realtime-user-initial",
      "realtime-user-steer-first",
      "realtime-user-steer-last",
    ]);
    expect(store.getState().getItem("realtime-user-steer-first", "turn-running")).toMatchObject({
      skills: [{ name: "steer-first-skill" }],
    });
    expect(store.getState().getItem("realtime-user-steer-last", "turn-running")).toMatchObject({
      skills: [{ name: "steer-last-skill" }],
      text: "补充测试覆盖",
    });
  });

  it("updates one existing delta without replacing structural references", () => {
    const store = createTaskStore({ projectId: "project-1", taskId: "task-1" }, createResponse());
    const previousState = store.getState();
    const previousItemStoresById = previousState.itemStoresByKey;
    const previousCompletedTurn = previousState.turnsById["turn-completed"];
    const previousRunningTurn = previousState.turnsById["turn-running"];
    const previousCompletedItemStore = previousState.itemStoresByKey.get(
      createTaskItemKey("turn-completed", "message-completed"),
    );
    const previousRunningItemStore = previousState.itemStoresByKey.get(
      runningItemKey("message-running"),
    );
    const previousRunningItemIds = previousState.itemKeysByTurnId["turn-running"];
    const previousStructureRevision = previousState.itemStructureRevision;
    const completedItemListener = vi.fn();
    const runningItemListener = vi.fn();
    const unsubscribeCompleted = previousCompletedItemStore?.subscribe(completedItemListener);
    const unsubscribeRunning = previousRunningItemStore?.subscribe(runningItemListener);
    const runningItemReadSpy =
      previousRunningItemStore === undefined
        ? undefined
        : vi.spyOn(previousRunningItemStore, "read");

    store.getState().applyEvents([
      {
        ...eventEnvelope(11),
        itemId: "message-running",
        payload: { delta: "继续" },
        turnId: "turn-running",
        type: "message.delta",
      },
      {
        ...eventEnvelope(12),
        itemId: "message-running",
        payload: { delta: "输出" },
        turnId: "turn-running",
        type: "message.delta",
      },
    ]);
    const nextState = store.getState();

    expect(nextState.turnsById["turn-completed"]).toBe(previousCompletedTurn);
    expect(nextState.turnsById["turn-running"]).toBe(previousRunningTurn);
    expect(nextState.itemStoresByKey).toBe(previousItemStoresById);
    expect(
      nextState.itemStoresByKey.get(createTaskItemKey("turn-completed", "message-completed")),
    ).toBe(previousCompletedItemStore);
    expect(nextState.itemKeysByTurnId["turn-running"]).toBe(previousRunningItemIds);
    expect(nextState.itemStructureRevision).toBe(previousStructureRevision);
    expect(runningItemReadSpy).not.toHaveBeenCalled();
    expect(nextState.getItem("message-running", "turn-running")).toMatchObject({
      text: "开始继续输出",
    });
    expect(completedItemListener).not.toHaveBeenCalled();
    expect(runningItemListener).toHaveBeenCalledOnce();
    unsubscribeCompleted?.();
    unsubscribeRunning?.();
    runningItemReadSpy?.mockRestore();
  });
});
