import { describe, expect, it, vi } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import type { CodexProviderLogger } from "./agent-provider.js";
import {
  FakeRpcClient,
  project,
  createCodexAgentProvider,
  nativeThread,
} from "./agent-provider.test-support.js";

describe("CodexAgentProvider diagnostics", () => {
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
          codexVersion: "0.161.0",
          diagnosticCode: "unknown_notification",
          method: "future/notification",
          projectId: "codexly",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
      [
        {
          codexVersion: "0.161.0",
          diagnosticCode: "invalid_notification",
          method: "thread/goal/updated",
          projectId: "codexly",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
      [
        {
          codexVersion: "0.161.0",
          diagnosticCode: "invalid_notification",
          method: "item/agentMessage/delta",
          projectId: "codexly",
          taskId: "task-1",
        },
        "Codex notification dropped",
      ],
      [
        {
          codexVersion: "0.161.0",
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
