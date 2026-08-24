import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@code-agent/core";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider realtime events", () => {
  it("rejects task metadata mutations outside the current project", async () => {
    const rpc = new FakeRpcClient([]);
    const provider = createCodexAgentProvider({ client: rpc, project });

    await expect(provider.renameTask("unknown-task", "新的任务名称")).rejects.toThrow(
      "does not belong to the active project",
    );
    await expect(provider.archiveTask("unknown-task")).rejects.toThrow(
      "does not belong to the active project",
    );
    expect(rpc.calls).toEqual([]);
  });

  it("maps Codex notifications to provider-independent realtime events", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: unknown[] = [];
    const unsubscribe = provider.subscribeEvents((event) => {
      events.push(event);
    });
    await provider.listTasks();
    const runningTurn = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn-1",
      items: [],
      itemsView: { type: "full" },
      startedAt: 1_753_228_800,
      status: "inProgress",
    };
    const completedItem = {
      delivery: null,
      id: "item-1",
      text: "实时完成",
      type: "agentMessage",
    };
    const startedSubagentItem = {
      agentsStates: {},
      id: "subagent-spawn",
      model: "gpt-5.6-sol",
      prompt: "理解前端项目",
      reasoningEffort: "high",
      receiverThreadIds: [],
      senderThreadId: "task-1",
      status: "inProgress",
      tool: "spawnAgent",
      type: "collabAgentToolCall",
    };
    const completedTurn = {
      ...runningTurn,
      completedAt: 1_753_228_801,
      items: [completedItem],
      status: "completed",
    };

    rpc.emitNotification("turn/started", { threadId: "task-1", turn: runningTurn });
    rpc.emitNotification("item/started", {
      item: startedSubagentItem,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "实时",
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/reasoning/summaryTextDelta", {
      delta: "分析",
      itemId: "item-2",
      summaryIndex: 0,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/reasoning/textDelta", {
      contentIndex: 0,
      delta: "细节",
      itemId: "item-2",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/commandExecution/outputDelta", {
      delta: "Done\n",
      itemId: "item-3",
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/completed", {
      completedAtMs: 1_753_228_801_000,
      item: completedItem,
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("thread/tokenUsage/updated", {
      threadId: "task-1",
      tokenUsage: {
        last: {
          cacheWriteInputTokens: 0,
          cachedInputTokens: 10_000,
          inputTokens: 20_000,
          outputTokens: 4_000,
          reasoningOutputTokens: 1_000,
          totalTokens: 25_000,
        },
        modelContextWindow: 200_000,
        total: {
          cacheWriteInputTokens: 0,
          cachedInputTokens: 10_000,
          inputTokens: 80_000,
          outputTokens: 15_000,
          reasoningOutputTokens: 5_000,
          totalTokens: 100_000,
        },
      },
      turnId: "turn-1",
    });
    rpc.emitNotification("turn/completed", { threadId: "task-1", turn: completedTurn });
    rpc.emitNotification("error", {
      error: { message: "模型服务不可用" },
      threadId: "task-1",
      turnId: "turn-1",
      willRetry: false,
    });

    expect(events).toEqual([
      {
        payload: {
          turn: {
            completedAt: null,
            error: null,
            id: "turn-1",
            items: [],
            startedAt: "2025-07-23T00:00:00.000Z",
            status: "running",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "turn.started",
      },
      {
        itemId: "subagent-spawn",
        payload: {
          item: {
            id: "subagent-spawn",
            input: {
              model: "gpt-5.6-sol",
              prompt: "理解前端项目",
              reasoningEffort: "high",
              receiverTaskIds: [],
              senderTaskId: "task-1",
            },
            name: "agent/spawn",
            output: { agents: [] },
            status: "running",
            type: "tool",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "item.started",
      },
      {
        itemId: "item-1",
        payload: { delta: "实时" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "message.delta",
      },
      {
        itemId: "item-2",
        payload: { delta: "分析", field: "summary", sectionIndex: 0 },
        taskId: "task-1",
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        itemId: "item-2",
        payload: { delta: "细节", field: "content" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "reasoning.delta",
      },
      {
        itemId: "item-3",
        payload: { delta: "Done\n" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "command.output_delta",
      },
      {
        itemId: "item-1",
        payload: {
          item: { id: "item-1", role: "assistant", text: "实时完成", type: "message" },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "item.completed",
      },
      {
        payload: { usage: { contextWindow: 200_000, usedTokens: 25_000 } },
        taskId: "task-1",
        turnId: "turn-1",
        type: "usage.updated",
      },
      {
        payload: {
          turn: {
            completedAt: "2025-07-23T00:00:01.000Z",
            error: null,
            id: "turn-1",
            items: [{ id: "item-1", role: "assistant", text: "实时完成", type: "message" }],
            startedAt: "2025-07-23T00:00:00.000Z",
            status: "completed",
          },
        },
        taskId: "task-1",
        turnId: "turn-1",
        type: "turn.completed",
      },
      {
        payload: { message: "模型服务不可用", willRetry: false },
        taskId: "task-1",
        turnId: "turn-1",
        type: "provider.error",
      },
    ]);

    unsubscribe();
    rpc.emitNotification("item/agentMessage/delta", {
      delta: "不应交付",
      itemId: "item-1",
      threadId: "task-1",
      turnId: "turn-1",
    });
    expect(events).toHaveLength(10);
  });

  it("publishes generated images as readable realtime attachment metadata", async () => {
    const imageContent = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const encodedImage = imageContent.toString("base64");
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("item/completed", {
      item: {
        id: "generated-image-live",
        failure: null,
        result: encodedImage,
        revisedPrompt: null,
        status: "completed",
        type: "imageGeneration",
      },
      threadId: "task-1",
      turnId: "turn-1",
    });

    const event = events[0];
    const item = event?.type === "item.completed" ? event.payload.item : undefined;
    const attachmentId = item?.type === "message" ? item.attachments?.[0]?.id : undefined;
    expect(event).toEqual({
      itemId: "generated-image-live",
      payload: {
        item: {
          attachments: [
            {
              id: attachmentId,
              kind: "image",
              mediaType: "image/png",
              name: "生成图片-1.png",
              size: imageContent.byteLength,
            },
          ],
          id: "generated-image-live",
          role: "assistant",
          text: "",
          type: "message",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });
    expect(JSON.stringify(event)).not.toContain(encodedImage);
    await expect(provider.readTaskAttachment("task-1", attachmentId ?? "")).resolves.toMatchObject({
      content: imageContent,
      mediaType: "image/png",
    });
  });

  it("maps image generation usage-limit failures without exposing provider identifiers", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("item/completed", {
      item: {
        failure: {
          limitId: "private-image-limit-id",
          resetsAt: 1_777_777_777,
          type: "usageLimitExceeded",
        },
        id: "generated-image-failed",
        result: "",
        revisedPrompt: null,
        status: "failed",
        type: "imageGeneration",
      },
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(events[0]).toMatchObject({
      payload: {
        item: {
          id: "generated-image-failed",
          name: "image_generation",
          output: { reason: "usage_limit_exceeded", resetsAt: 1_777_777_777 },
          status: "failed",
          type: "tool",
        },
      },
      taskId: "task-1",
      turnId: "turn-1",
      type: "item.completed",
    });
    expect(JSON.stringify(events[0])).not.toContain("private-image-limit-id");
  });

  it("publishes structured item starts for live operation status", async () => {
    const rpc = new FakeRpcClient([{ data: [nativeThread()], nextCursor: null }]);
    const provider = createCodexAgentProvider({ client: rpc, project });
    const events: AgentProviderEvent[] = [];
    provider.subscribeEvents((event) => events.push(event));
    await provider.listTasks();

    rpc.emitNotification("item/started", {
      item: {
        aggregatedOutput: null,
        command: "sed -n '1,240p' SKILL.md",
        commandActions: [],
        cwd: "/workspace/CodeAgent",
        durationMs: null,
        exitCode: null,
        id: "command-read-skill",
        processId: null,
        source: "agent",
        status: "inProgress",
        type: "commandExecution",
      },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/started", {
      item: {
        arguments: { query: "live operation status" },
        error: null,
        id: "tool-search",
        result: null,
        server: "fast-context",
        status: "inProgress",
        tool: "search",
        type: "mcpToolCall",
      },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/started", {
      item: { id: "image-view", path: "/workspace/CodeAgent/status.png", type: "imageView" },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/started", {
      item: { id: "context-compaction", type: "contextCompaction" },
      threadId: "task-1",
      turnId: "turn-1",
    });
    rpc.emitNotification("item/completed", {
      item: { id: "context-compaction", type: "contextCompaction" },
      threadId: "task-1",
      turnId: "turn-1",
    });

    expect(events).toMatchObject([
      {
        itemId: "command-read-skill",
        payload: {
          item: {
            command: "sed -n '1,240p' SKILL.md",
            status: "running",
            type: "command",
          },
        },
        type: "item.started",
      },
      {
        itemId: "tool-search",
        payload: {
          item: { name: "fast-context/search", status: "running", type: "tool" },
        },
        type: "item.started",
      },
      {
        itemId: "image-view",
        payload: {
          item: { label: "查看图片", status: "running", type: "activity" },
        },
        type: "item.started",
      },
      {
        itemId: "context-compaction",
        payload: {
          item: {
            label: "上下文压缩",
            status: "running",
            transient: true,
            type: "activity",
          },
        },
        type: "item.started",
      },
      {
        itemId: "context-compaction",
        payload: {
          item: { label: "上下文压缩", transient: true, type: "activity" },
        },
        type: "item.completed",
      },
    ]);
  });
});
