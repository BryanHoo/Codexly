import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@code-agent/core";
import {
  FakeRpcClient,
  projectRootPath,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider streamed messages", () => {
  it("streams commentary and final answers as normal assistant messages", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();

    const commentaryItem = {
      delivery: null,
      id: "commentary-1",
      memoryCitation: null,
      phase: "commentary",
      text: "正在扫描项目结构。",
      type: "agentMessage",
    };
    rpc.emitNotification("item/started", {
      item: { ...commentaryItem, text: "" },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "正在扫描项目结构。",
      itemId: "commentary-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/completed", {
      item: commentaryItem,
      threadId: "task-1",
      turnId: "turn-1",
    });

    const finalAnswerItem = {
      delivery: null,
      id: "answer-1",
      memoryCitation: null,
      phase: "final_answer",
      text: "项目已理解。",
      type: "agentMessage",
    };
    rpc.emitNotification("item/started", {
      item: { ...finalAnswerItem, text: "" },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "项目已理解。",
      itemId: "answer-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/completed", {
      item: finalAnswerItem,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("turn/completed", {
      threadId: "task-1",
      turn: {
        completedAt: 1_753_228_801,
        error: null,
        id: "turn-1",
        items: [commentaryItem, finalAnswerItem],
        startedAt: 1_753_228_800,
        status: "completed",
      },
    });

    expect(events).toEqual([
      {
        itemId: "commentary-1",
        payload: { delta: "正在扫描项目结构。" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        itemId: "commentary-1",
        payload: {
          item: {
            id: "commentary-1",
            phase: "commentary",
            role: "assistant",
            text: "正在扫描项目结构。",
            type: "message",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "item.completed",
      },
      {
        itemId: "answer-1",
        payload: { delta: "项目已理解。" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        itemId: "answer-1",
        payload: {
          item: {
            id: "answer-1",
            phase: "final_answer",
            role: "assistant",
            text: "项目已理解。",
            type: "message",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "item.completed",
      },
      {
        payload: {
          turn: {
            completedAt: "2025-07-23T00:00:01.000Z",
            error: null,
            id: "turn-1",
            items: [
              {
                id: "commentary-1",
                phase: "commentary",
                role: "assistant",
                text: "正在扫描项目结构。",
                type: "message",
              },
              {
                id: "answer-1",
                phase: "final_answer",
                role: "assistant",
                text: "项目已理解。",
                type: "message",
              },
            ],
            startedAt: "2025-07-23T00:00:00.000Z",
            status: "completed",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "turn.completed",
      },
    ]);
  });

  it("does not publish notifications for tasks outside the active project", async () => {
    let pendingResolution: Promise<unknown> | undefined;
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("foreign-request", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/other",
          itemId: "foreign-file",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-foreign",
          turnId: "turn-foreign",
        });
        pendingResolution = provider
          .resolvePendingRequest({
            itemId: "foreign-file",
            projectId: project.id,
            requestId: "string:foreign-request",
            resolution: { decision: "deny" },
            taskId: "task-foreign",
            turnId: "turn-foreign",
            type: "file_change_approval",
          })
          .then(
            () => "resolved",
            (error: unknown) => error,
          );
        return {
          thread: nativeThread({
            cwd: projectRootPath,
            id: "task-foreign",
            projectId: "foreign-project",
          }),
        };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => {
      events.push(event);
    });

    await expect(provider.readTask("task-foreign")).resolves.toBeUndefined();
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "不应泄漏",
      itemId: "item-foreign",
      threadId: "task-foreign",
      turnId: "turn-foreign",
    });

    expect(events).toEqual([]);
    await expect(pendingResolution).resolves.toMatchObject({ code: "not_found" });
    expect(rpc.serverResponses).toEqual([]);
  });

  it("restores server requests received while readTask validates project ownership", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("during-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "file-during-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => events.push(event));

    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.pendingRequests).toEqual([
      expect.objectContaining({ requestId: "string:during-read", status: "pending" }),
    ]);
    expect(events).toEqual([expect.objectContaining({ type: "pending_request.created" })]);
  });

  it("preserves owned server requests when task snapshot mapping fails", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("during-invalid-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "file-during-invalid-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-1",
        });
        return { thread: nativeThread({ turns: [] }) };
      },
      { backwardsCursor: null, data: null, nextCursor: null },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));

    await expect(provider.readTask("task-1")).rejects.toThrow(
      "thread/turns/list data must be an array",
    );
    await expect(
      provider.resolvePendingRequest({
        itemId: "file-during-invalid-read",
        projectId: project.id,
        requestId: "string:during-invalid-read",
        resolution: { decision: "deny" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "file_change_approval",
      }),
    ).resolves.toMatchObject({ status: "resolved" });

    expect(rpc.serverResponses).toEqual([
      { id: "during-invalid-read", result: { decision: "decline" } },
    ]);
    expect(events.map((event) => event.type)).toEqual([
      "pending_request.created",
      "pending_request.resolved",
    ]);
  });

  it("does not restore server requests resolved while readTask validates ownership", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("resolved-during-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "resolved-file-during-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-1",
        });
        rpc.emitNotification("serverRequest/resolved", {
          requestId: "resolved-during-read",
          threadId: "task-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => events.push(event));

    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.pendingRequests).toEqual([]);
    expect(events).toEqual([]);
  });

  it("does not restore server requests whose turn completes during ownership validation", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitServerRequest("completed-during-read", "item/fileChange/requestApproval", {
          grantRoot: "/workspace/CodeAgent",
          itemId: "completed-file-during-read",
          reason: null,
          startedAtMs: 1_753_228_801_000,
          threadId: "task-1",
          turnId: "turn-completed-during-read",
        });
        rpc.emitNotification("turn/completed", {
          threadId: "task-1",
          turn: {
            completedAt: 1_753_228_802,
            error: null,
            id: "turn-completed-during-read",
            items: [],
            startedAt: 1_753_228_800,
            status: "completed",
          },
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    provider.subscribeEvents((event) => events.push(event));

    const snapshot = await provider.readTask("task-1");

    expect(snapshot?.pendingRequests).toEqual([]);
    expect(events).toEqual([expect.objectContaining({ type: "turn.completed" })]);
  });

  it("delivers notifications received while readTask is validating project ownership", async () => {
    const deliveryOrder: string[] = [];
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitNotification("item/agentMessage/delta", {
          delta: "读取期间到达",
          itemId: "item-1",
          threadId: "task-1",
          turnId: "turn-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    provider.subscribeEvents(() => {
      deliveryOrder.push("event");
    });

    await provider.readTask("task-1");
    deliveryOrder.push("snapshot");

    expect(deliveryOrder).toEqual(["event", "snapshot"]);
  });

  it("restores the latest context usage after validating project ownership", async () => {
    const rpc = new FakeRpcClient([
      () => {
        rpc.emitNotification("thread/tokenUsage/updated", {
          threadId: "task-1",
          tokenUsage: {
            last: { totalTokens: 25_000 },
            modelContextWindow: 200_000,
            total: { totalTokens: 100_000 },
          },
          turnId: "turn-1",
        });
        return { thread: nativeThread() };
      },
    ]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.readTask("task-1")).resolves.toMatchObject({
      contextUsage: { contextWindow: 200_000, usedTokens: 25_000 },
    });
  });
});
