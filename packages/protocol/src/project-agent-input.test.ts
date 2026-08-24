import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  AgentAttachmentSchema,
  AgentAttachmentUploadResponseSchema,
  AgentModelPageSchema,
  AgentMcpServerPageSchema,
  AgentPromptInputSchema,
  AgentSkillPageSchema,
  AgentMutationErrorSchema,
  AgentTaskSettingsSchema,
  AgentTurnOptionsSchema,
  InterruptAgentTurnRequestSchema,
  InterruptAgentTurnResponseSchema,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_FILE_TOTAL_BYTES,
  MAX_AGENT_IMAGE_BYTES,
  MAX_AGENT_IMAGES,
  MAX_AGENT_IMAGE_TOTAL_BYTES,
  MAX_AGENT_TEXT_BYTES,
  StartAgentTaskRequestSchema,
  StartAgentTaskResponseSchema,
  StartAgentTurnRequestSchema,
  StartAgentTurnResponseSchema,
  SteerAgentTurnRequestSchema,
  SteerAgentTurnResponseSchema,
  ReloadAgentMcpServersRequestSchema,
  ReloadAgentMcpServersResponseSchema,
} from "./project.js";

describe("project agent input protocol", () => {
  it("validates structured Agent inputs and mutation contracts", () => {
    const task = {
      id: "task-1",
      pinned: false,
      projectId: "codexly",
      title: "实现写入闭环",
      updatedAt: "2026-07-23T00:00:00.000Z",
    };
    const turn = {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [],
      startedAt: "2026-07-23T00:00:00.000Z",
      status: "running",
    };

    const attachment = {
      id: "attachment-1",
      kind: "image",
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    };
    const prompt = {
      attachments: [{ id: attachment.id }],
      skills: [],
      text: "参考截图实现功能",
      type: "prompt",
    };

    expect(
      Value.Check(AgentSkillPageSchema, {
        data: [
          {
            description: "执行严格的安全审查",
            displayName: "Security review",
            id: "skill_01J00000000000000000000000",
            name: "review-security",
            scope: "system",
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMcpServerPageSchema, {
        data: [
          {
            authStatus: "unknown",
            description: "Search the current repository",
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "ready",
            title: "Fast Context",
            toolCount: 3,
            version: "1.2.0",
          },
          {
            authStatus: null,
            description: null,
            error: "MCP startup timed out after 10s",
            failureReason: null,
            name: "chrome-devtools",
            status: "failed",
            title: null,
            toolCount: 0,
            version: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMcpServerPageSchema, {
        data: [
          {
            authStatus: "unsupported",
            command: "npx",
            description: null,
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "ready",
            title: null,
            toolCount: 1,
            version: null,
          },
        ],
      }),
    ).toBe(false);
    expect(Value.Check(ReloadAgentMcpServersRequestSchema, {})).toBe(true);
    expect(
      Value.Check(ReloadAgentMcpServersResponseSchema, {
        data: [
          {
            authStatus: null,
            description: null,
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "starting",
            title: null,
            toolCount: 0,
            version: null,
          },
        ],
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMcpServerPageSchema, {
        data: [
          {
            authStatus: null,
            description: null,
            error: null,
            failureReason: null,
            name: "fast-context",
            status: "unknown",
            title: null,
            toolCount: 0,
            version: null,
          },
        ],
      }),
    ).toBe(false);

    expect(
      Value.Check(AgentModelPageSchema, {
        data: [
          {
            defaultReasoningEffort: "high",
            description: "适合复杂编码任务",
            displayName: "GPT-5.6 Sol",
            id: "gpt-5.6-sol",
            isDefault: true,
            supportedReasoningEfforts: [
              { description: "快速回答", id: "low" },
              { description: "深入分析", id: "high" },
            ],
          },
        ],
        nextCursor: null,
      }),
    ).toBe(true);
    expect(Value.Check(AgentAttachmentSchema, attachment)).toBe(true);
    expect(Value.Check(AgentAttachmentUploadResponseSchema, { attachment })).toBe(true);
    expect(Value.Check(AgentPromptInputSchema, prompt)).toBe(true);
    const planTurnOptions = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      collaborationMode: "plan",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };
    expect(Value.Check(AgentTurnOptionsSchema, planTurnOptions)).toBe(true);
    expect(
      Value.Check(AgentTurnOptionsSchema, {
        ...planTurnOptions,
        approvalPolicy: "untrusted",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentTurnOptionsSchema, {
        ...planTurnOptions,
        approvalPolicy: {
          granular: {
            mcp_elicitations: false,
            request_permissions: true,
            rules: false,
            sandbox_approval: true,
            skill_approval: false,
          },
        },
      }),
    ).toBe(true);
    expect(Value.Check(AgentTaskSettingsSchema, planTurnOptions)).toBe(false);
    expect(Value.Check(AgentTurnOptionsSchema, { ...planTurnOptions, fastMode: true })).toBe(true);
    expect(Value.Check(AgentTurnOptionsSchema, { ...planTurnOptions, fastMode: false })).toBe(
      false,
    );
    const goalTurnOptions = {
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      goalMode: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };
    expect(Value.Check(AgentTurnOptionsSchema, goalTurnOptions)).toBe(true);
    expect(Value.Check(AgentTaskSettingsSchema, goalTurnOptions)).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [{ id: attachment.id }],
        skills: [],
        text: "",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [{ id: "skill_01J00000000000000000000000", name: "review-security" }],
        text: "",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [],
        text: "",
        type: "prompt",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [
          { id: "skill-1", name: "first" },
          { id: "skill-2", name: "second" },
        ],
        text: "run",
        type: "prompt",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentPromptInputSchema, {
        attachments: [],
        skills: [{ id: "skill-1", name: "first", path: "/private/skill" }],
        text: "run",
        type: "prompt",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentAttachmentSchema, {
        id: "attachment-text",
        kind: "text",
        mediaType: "text/plain",
        name: "Pasted text.txt",
        size: 5,
      }),
    ).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(StartAgentTaskRequestSchema, { nativeOptions: {} })).toBe(false);
    expect(Value.Check(StartAgentTaskResponseSchema, { task })).toBe(true);
    expect(
      Value.Check(StartAgentTurnRequestSchema, {
        input: prompt,
        options: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(StartAgentTurnRequestSchema, {
        input: prompt,
        options: {
          approvalPolicy: "always",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).toBe(false);
    expect(Value.Check(StartAgentTurnResponseSchema, { taskId: task.id, turn })).toBe(true);
    expect(Value.Check(SteerAgentTurnRequestSchema, { input: prompt, taskId: task.id })).toBe(true);
    expect(
      Value.Check(SteerAgentTurnResponseSchema, {
        status: "accepted",
        taskId: task.id,
        turnId: turn.id,
      }),
    ).toBe(true);
    expect(
      Value.Check(SteerAgentTurnRequestSchema, {
        input: prompt,
        options: { model: "gpt-5.6-sol" },
        taskId: task.id,
      }),
    ).toBe(false);
    expect(Value.Check(InterruptAgentTurnRequestSchema, { taskId: task.id })).toBe(true);
    expect(
      Value.Check(InterruptAgentTurnResponseSchema, {
        status: "interrupting",
        taskId: task.id,
        turnId: turn.id,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMutationErrorSchema, {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key was already used with another request",
        retryable: false,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentMutationErrorSchema, {
        code: "IDEMPOTENCY_CAPACITY_EXCEEDED",
        message: "Too many idempotent requests are in progress",
        retryable: true,
      }),
    ).toBe(true);
    for (const code of [
      "ACCESS_DENIED",
      "PAIRING_FAILED",
      "PAIRING_RATE_LIMITED",
      "GIT_WORKTREE_ALREADY_ACTIVE",
      "GIT_WORKTREE_CREATE_FAILED",
      "GIT_WORKTREE_NOT_FOUND",
    ]) {
      expect(
        Value.Check(AgentMutationErrorSchema, {
          code,
          message: "Access request failed",
          retryable: false,
        }),
      ).toBe(true);
    }
  });

  it("uses bounded image, file, and pasted text input limits", () => {
    expect(MAX_AGENT_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_AGENT_FILE_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_AGENT_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_AGENT_IMAGES).toBe(20);
    expect(MAX_AGENT_IMAGE_TOTAL_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_AGENT_TEXT_BYTES).toBe(1024 * 1024);
  });
});
