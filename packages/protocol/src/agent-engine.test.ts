import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { StartAgentTaskRequestSchema } from "./agent-actions.js";
import { AgentTaskBaseSchema } from "./task-common.js";
import { AgentTaskSnapshotSchema } from "./agent-runtime.js";
import { PendingRequestSchema, ResolvePendingRequestRequestSchema } from "./pending-request.js";
import { AgentTaskSettingsSchema } from "./project-settings.js";
import { ClaudeSettingsSchema, DEFAULT_CLAUDE_SETTINGS } from "./agent-engine.js";

describe("conversation engine identity", () => {
  it("配置与会话协议均接受原生 auto 权限模式", () => {
    expect(
      Value.Check(ClaudeSettingsSchema, { ...DEFAULT_CLAUDE_SETTINGS, permissionMode: "auto" }),
    ).toBe(true);
    expect(
      Value.Check(AgentTaskSettingsSchema, {
        model: "sonnet",
        reasoningEffort: "",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        engineOptions: { engine: "claude", permissionMode: "auto" },
      }),
    ).toBe(true);
  });
  it("keeps Claude permission modes independent from Codex sandbox and accepts generic tool approvals", () => {
    const settings = {
      model: "sonnet",
      reasoningEffort: "",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxMode: "workspace-write",
    };
    expect(
      Value.Check(AgentTaskSettingsSchema, {
        ...settings,
        engineOptions: { engine: "claude", permissionMode: "acceptEdits" },
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentTaskSettingsSchema, {
        ...settings,
        engineOptions: { engine: "claude", permissionMode: "workspace-write" },
      }),
    ).toBe(false);
    const identity = { itemId: "tool", projectId: "p", taskId: "t", turnId: "turn" };
    const pending = {
      ...identity,
      requestId: "r",
      createdAt: "2026-10-16T00:00:00Z",
      expiresAt: null,
      status: "pending",
      type: "tool_approval",
      toolName: "Read",
      input: { file_path: "/tmp/example" },
      reason: "Outside workspace",
      availableDecisions: ["allow", "deny"],
    };
    expect(Value.Check(PendingRequestSchema, pending)).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        ...identity,
        type: "tool_approval",
        resolution: { decision: "allow" },
      }),
    ).toBe(true);
  });
  it("accepts an explicit engine only at task creation and keeps old clients compatible", () => {
    expect(Value.Check(StartAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, { engine: "codex" })).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, { engine: "claude" })).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, { engine: "unknown" })).toBe(false);
  });

  it("carries the same optional engine identity in task lists and snapshots", () => {
    expect(AgentTaskBaseSchema.properties).toHaveProperty("engine");
    expect(AgentTaskSnapshotSchema.properties.engine).toBe(AgentTaskBaseSchema.properties.engine);
    expect(AgentTaskBaseSchema.required).not.toContain("engine");
  });
});
