import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import type { Project } from "@codexly/protocol";
import { createCodexRuntimeProvider, type CodexProviderLogger } from "./agent-provider.js";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider history", () => {
  it("uses all aggregate project roots as runtime workspaces", async () => {
    const aggregateProject = {
      createdAt: project.createdAt,
      id: project.id,
      name: project.name,
      roots: [
        { id: "root-primary", path: "/workspace/primary" },
        { id: "root-secondary", path: "/workspace/secondary" },
      ],
    } as Project;
    const rpc = new FakeRpcClient([{ thread: nativeThread({ cwd: "/workspace/primary" }) }]);

    await createCodexRuntimeProvider({ client: rpc }).forProject(aggregateProject).startTask();

    expect(rpc.calls[0]).toEqual({
      method: "thread/start",
      params: {
        cwd: "/workspace/primary",
        historyMode: "paginated",
        projectId: project.id,
        runtimeWorkspaceRoots: ["/workspace/primary", "/workspace/secondary"],
      },
    });
  });

  it("reads only the newest bounded task turn page", async () => {
    const turn = {
      completedAt: 1_753_232_400,
      error: null,
      id: "turn-newest",
      items: [{ delivery: null, id: "message-1", text: "最新回复", type: "agentMessage" }],
      itemsView: "full",
      startedAt: 1_753_228_800,
      status: "completed",
    };
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ name: "分页历史", turns: [] }) },
      { backwardsCursor: "newer", data: [turn], nextCursor: "older-turns" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const result = await provider.readTask("task-1");
    expect(result).toMatchObject({ turns: [{ id: "turn-newest" }] });
    expect(typeof result?.turnsNextCursor).toBe("string");
    expect(rpc.calls).toEqual([
      {
        method: "thread/read",
        params: { includeTurns: false, threadId: "task-1" },
      },
      { method: "thread/goal/get", params: { threadId: "task-1" } },
      {
        method: "thread/turns/list",
        params: {
          itemsView: "full",
          limit: 10,
          sortDirection: "desc",
          threadId: "task-1",
        },
      },
    ]);
  });

  it("hydrates paginated turn items and continues from the provider cursor", async () => {
    const nativeTurn = (id: string) => ({
      completedAt: 1_753_232_400,
      error: null,
      id,
      items: [],
      itemsView: "notLoaded",
      startedAt: 1_753_228_800,
      status: "completed",
    });
    const itemEntry = (turnId: string, text: string) => ({
      item: { delivery: null, id: `${turnId}-message`, text, type: "agentMessage" },
      turnId,
    });
    const itemPage = (turnId: string, text: string, nextCursor: string | null = null) => ({
      backwardsCursor: null,
      data: [itemEntry(turnId, text)],
      nextCursor,
    });
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ historyMode: "paginated", turns: undefined }) },
      { backwardsCursor: "newer", data: [nativeTurn("turn-new")], nextCursor: "older" },
      itemPage("turn-new", "最新回复"),
      { thread: nativeThread({ historyMode: "paginated", turns: undefined }) },
      { backwardsCursor: "anchor", data: [nativeTurn("turn-old")], nextCursor: null },
      itemPage("turn-old", "更早回复"),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const newest = await provider.readTask("task-1");
    const cursor = newest?.turnsNextCursor;
    expect(cursor).toEqual(expect.any(String));
    if (cursor === null || cursor === undefined) {
      throw new Error("Expected a task turn cursor");
    }
    await expect(provider.readTask("task-1", { cursor })).resolves.toMatchObject({
      turns: [
        {
          id: "turn-old",
          items: [{ id: "turn-old-message", text: "更早回复" }],
        },
      ],
      turnsNextCursor: null,
    });
    expect(rpc.calls.filter(({ method }) => method === "thread/items/list")).toEqual([
      {
        method: "thread/items/list",
        params: {
          limit: 100,
          sortDirection: "desc",
          threadId: "task-1",
          turnId: "turn-new",
        },
      },
      {
        method: "thread/items/list",
        params: {
          limit: 100,
          sortDirection: "desc",
          threadId: "task-1",
          turnId: "turn-old",
        },
      },
    ]);
  });

  it("hydrates each turn in one bounded page with turn-scoped item RPCs", async () => {
    const nativeTurn = (index: number) => ({
      completedAt: 1_753_232_400 + index,
      error: null,
      id: `turn-${String(index)}`,
      items: [],
      itemsView: "notLoaded",
      startedAt: 1_753_228_800 + index,
      status: "completed",
    });
    const turns = Array.from({ length: 10 }, (_, index) => nativeTurn(10 - index));
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ historyMode: "paginated", turns: undefined }) },
      { backwardsCursor: "newer", data: turns, nextCursor: null },
      ...turns.map((turn) => ({
        backwardsCursor: `${turn.id}-newer-items`,
        data: [
          {
            item: {
              delivery: null,
              id: `${turn.id}-message`,
              text: turn.id,
              type: "agentMessage",
            },
            turnId: turn.id,
          },
        ],
        nextCursor: null,
      })),
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      turns: Array.from({ length: 10 }, (_, index) => ({
        id: `turn-${String(index + 1)}`,
        items: [{ id: `turn-${String(index + 1)}-message` }],
      })),
    });
    expect(rpc.calls.filter(({ method }) => method === "thread/items/list")).toEqual(
      turns.map((turn) => ({
        method: "thread/items/list",
        params: {
          limit: 100,
          sortDirection: "desc",
          threadId: "task-1",
          turnId: turn.id,
        },
      })),
    );
  });

  it("hydrates interrupted history when an older turn item completes after a newer turn starts", async () => {
    const currentTurn = {
      completedAt: null,
      error: null,
      id: "turn-current",
      items: [],
      itemsView: "notLoaded",
      startedAt: 1_753_232_400,
      status: "interrupted",
    };
    const itemEntry = (turnId: string, id: string, type: "agentMessage" | "userMessage") => ({
      item: {
        ...(type === "agentMessage" ? { delivery: null, text: id } : { content: [] }),
        id,
        type,
      },
      turnId,
    });
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ historyMode: "paginated", turns: undefined }) },
      { backwardsCursor: "newer", data: [currentTurn], nextCursor: "older-turns" },
      () => {
        const params = rpc.calls.at(-1)?.params as Record<string, unknown>;
        if (params["turnId"] === currentTurn.id) {
          return {
            backwardsCursor: "current-items",
            data: [
              itemEntry(currentTurn.id, "current-response", "agentMessage"),
              itemEntry(currentTurn.id, "current-prompt", "userMessage"),
            ],
            nextCursor: null,
          };
        }
        return {
          backwardsCursor: "newer-items",
          data: [
            itemEntry(currentTurn.id, "current-response", "agentMessage"),
            itemEntry("turn-older", "delayed-command", "agentMessage"),
            itemEntry(currentTurn.id, "current-prompt", "userMessage"),
            itemEntry("turn-older", "older-response", "agentMessage"),
          ],
          nextCursor: null,
        };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    const snapshot = await provider.readTask("task-1");
    expect(snapshot).toMatchObject({
      turns: [
        {
          id: currentTurn.id,
          items: [{ id: "current-prompt" }, { id: "current-response" }],
        },
      ],
    });
    expect(typeof snapshot?.turnsNextCursor).toBe("string");
    expect(rpc.calls.filter(({ method }) => method === "thread/items/list")).toEqual([
      {
        method: "thread/items/list",
        params: {
          limit: 100,
          sortDirection: "desc",
          threadId: "task-1",
          turnId: currentTurn.id,
        },
      },
    ]);
  });

  it("rejects a repeated task turn cursor", async () => {
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ turns: undefined }) },
      { backwardsCursor: null, data: [], nextCursor: "older" },
      { thread: nativeThread({ turns: undefined }) },
      { backwardsCursor: null, data: [], nextCursor: "older" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const firstPage = await provider.readTask("task-1");
    const cursor = firstPage?.turnsNextCursor;
    if (cursor === null || cursor === undefined) {
      throw new Error("Expected a task turn cursor");
    }

    await expect(provider.readTask("task-1", { cursor })).rejects.toThrow(
      "thread/turns/list returned a repeated cursor",
    );
  });

  it("rejects a repeated turn-scoped item cursor", async () => {
    const nativeTurn = (id: string) => ({
      completedAt: 1_753_232_400,
      error: null,
      id,
      items: [],
      itemsView: "notLoaded",
      startedAt: 1_753_228_800,
      status: "completed",
    });
    const itemEntry = (turnId: string) => ({
      item: {
        delivery: null,
        id: `${turnId}-message`,
        text: turnId,
        type: "agentMessage",
      },
      turnId,
    });
    const rpc = new FakeRpcClient([
      { thread: nativeThread({ historyMode: "paginated", turns: undefined }) },
      { backwardsCursor: "newer", data: [nativeTurn("turn-new")], nextCursor: null },
      { backwardsCursor: "item-new", data: [itemEntry("turn-new")], nextCursor: "item-old" },
      { backwardsCursor: "item-old", data: [itemEntry("turn-new")], nextCursor: "item-old" },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).rejects.toThrow(
      "thread/items/list returned a repeated cursor",
    );
  });

  it("requires the 0.149.0 nullable native project assignment", async () => {
    const missingRpc = new FakeRpcClient([
      { data: [nativeThread({ projectId: undefined })], nextCursor: null },
    ]);
    const invalidRpc = new FakeRpcClient([
      { data: [nativeThread({ projectId: 42 })], nextCursor: null },
    ]);
    const unassignedRpc = new FakeRpcClient([
      { data: [nativeThread({ projectId: null })], nextCursor: null },
    ]);

    await expect(
      createCodexAgentProvider({ client: missingRpc, project }).listTasks(),
    ).rejects.toThrow("Codex thread projectId must be a string or null");
    await expect(
      createCodexAgentProvider({ client: invalidRpc, project }).listTasks(),
    ).rejects.toThrow("Codex thread projectId must be a string or null");
    await expect(
      createCodexAgentProvider({ client: unassignedRpc, project }).listTasks(),
    ).rejects.toThrow("Codex thread does not belong to the active project");
  });

  it("publishes plan updates and restores the latest plan in task snapshots", async () => {
    const rpc = new FakeRpcClient([
      { data: [nativeThread()], nextCursor: null },
      { thread: nativeThread({ status: { type: "active" }, turns: [] }) },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("turn/plan/updated", {
      explanation: "先补齐数据链路，再接入界面。",
      plan: [
        { status: "completed", step: "定义协议" },
        { status: "inProgress", step: "接入右栏" },
        { status: "pending", step: "完成验证" },
      ],
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(events).toEqual([
      {
        payload: {
          plan: {
            explanation: "先补齐数据链路，再接入界面。",
            steps: [
              { status: "completed", text: "定义协议" },
              { status: "in_progress", text: "接入右栏" },
              { status: "pending", text: "完成验证" },
            ],
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "plan.updated",
      },
    ]);
    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      plan: {
        explanation: "先补齐数据链路，再接入界面。",
        steps: [
          { status: "completed", text: "定义协议" },
          { status: "in_progress", text: "接入右栏" },
          { status: "pending", text: "完成验证" },
        ],
      },
    });
  });

  it("warns with safe identity fields when dropping unknown or invalid notifications", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const warn = vi.fn<CodexProviderLogger["warn"]>();
    const provider = createCodexAgentProvider({ client: rpc, logger: { warn }, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    provider.subscribeEvents(() => {
      throw new Error("listener private state");
    });
    await provider.listTasks();

    provider.receiveNotification("future/notification", {
      private: "unknown-secret-body",
      threadId: "task-1",
    });
    provider.receiveNotification("thread/goal/updated", {
      goal: {
        objective: "完成 Goal 协议适配",
        status: "active",
        threadId: "task-1",
      },
      threadId: "task-1",
      turnId: null,
    });
    provider.receiveNotification("item/agentMessage/delta", {
      delta: { body: "invalid-secret-body" },
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    provider.receiveNotification("item/agentMessage/delta", {
      delta: "后续事件",
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(warn.mock.calls).toEqual([
      [
        {
          codexVersion: "0.149.0",
          diagnosticCode: "unknown_notification",
          method: "future/notification",
          projectId: "codexly",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
      [
        {
          codexVersion: "0.149.0",
          diagnosticCode: "invalid_notification",
          method: "thread/goal/updated",
          projectId: "codexly",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
      [
        {
          codexVersion: "0.149.0",
          diagnosticCode: "invalid_notification",
          method: "item/agentMessage/delta",
          projectId: "codexly",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
      [
        {
          codexVersion: "0.149.0",
          diagnosticCode: "event_listener_failed",
          eventType: "message.delta",
          projectId: "codexly",
          taskId: "task-1",
        },
        "Codex event listener failed",
      ],
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("unknown-secret-body");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("invalid-secret-body");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("listener private state");
    expect(events).toEqual([
      {
        itemId: "item-1",
        payload: { delta: "后续事件" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
    ]);
  });
});
