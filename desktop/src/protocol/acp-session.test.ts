import { expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { AgentEventSchema } from "./agent-event.js";
import { AgentTaskSnapshotSchema } from "./agent-runtime.js";
import { AgentTurnSchema } from "./agent-task.js";

it.each(["end_turn", "refusal", "max_tokens", "max_turn_requests", "cancelled"])(
  "桌面回合协议接受 ACP 原始停止原因 %s",
  (stopReason) => {
    expect(
      Value.Check(AgentTurnSchema, {
        id: "turn",
        startedAt: null,
        completedAt: null,
        error: null,
        items: [],
        status: "completed",
        stopReason,
      }),
    ).toBe(true);
  },
);

it("原生协议接收共享ACP状态与快照，并保留桌面到达时间", () => {
  const state = {
    configOptions: [],
    availableCommands: [{ name: "review", description: "检查", input: { hint: "范围" } }],
  };
  expect
    .soft(
      Value.Check(AgentEventSchema, {
        type: "acp.session.updated",
        taskId: "t",
        provider: "codex",
        version: 2,
        sequence: 1,
        sessionId: "application",
        timestamp: new Date().toISOString(),
        receivedAtUnixMs: 1,
        payload: { state },
      }),
    )
    .toBe(true);
  expect(
    Value.Check(AgentTaskSnapshotSchema, {
      engine: "codex",
      id: "t",
      projectId: "p",
      title: "历史",
      pinned: false,
      updatedAt: new Date().toISOString(),
      status: "idle",
      contextUsage: null,
      goal: null,
      plan: null,
      pendingRequests: [],
      turns: [],
      turnsNextCursor: null,
      settings: {
        model: "m",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      },
      acpSession: state,
    }),
  ).toBe(true);
});

it("桌面接受子会话条目和不占用父回合的后台事件", () => {
  const event = {
    taskId: "task",
    turnId: "background",
    provider: "codex",
    version: 2,
    sequence: 1,
    sessionId: "application",
    timestamp: new Date().toISOString(),
    receivedAtUnixMs: 1,
  };
  expect(Value.Check(AgentEventSchema, {
    ...event,
    type: "acp.background.updated",
    payload: { startedAt: event.timestamp, completedAt: null },
  })).toBe(true);
  expect(Value.Check(AgentEventSchema, {
    ...event,
    type: "item.started",
    itemId: "acp:child:nested:",
    payload: { item: {
      type: "acp_subagent",
      id: "acp:child:nested:",
      parentSessionId: "root",
      sessionId: "nested",
      title: "审阅",
    } },
  })).toBe(true);
});
