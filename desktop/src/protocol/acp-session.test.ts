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
