import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  AgentCapabilitiesSchema,
  ArchiveAgentTaskRequestSchema,
  ArchiveAgentTaskResponseSchema,
  PendingRequestSchema,
  HealthResponseSchema,
  PinAgentTaskRequestSchema,
  PinAgentTaskResponseSchema,
  CompactAgentTaskRequestSchema,
  CompactAgentTaskResponseSchema,
  ForkAgentTaskRequestSchema,
  ForkAgentTaskResponseSchema,
  ReviewAgentTaskRequestSchema,
  ReviewAgentTaskResponseSchema,
  RenameAgentTaskRequestSchema,
  RenameAgentTaskResponseSchema,
  UploadAgentFeedbackRequestSchema,
  UploadAgentFeedbackResponseSchema,
  ResolvePendingRequestRequestSchema,
  ResolvePendingRequestResponseSchema,
} from "./project.js";

describe("project pending request protocol", () => {
  it("validates discriminated pending requests and typed resolutions", () => {
    const identity = {
      createdAt: "2026-07-23T00:00:00.000Z",
      expiresAt: null,
      itemId: "item-1",
      projectId: "codexly",
      requestId: "number:7",
      status: "pending",
      taskId: "task-1",
      turnId: "turn-1",
    } as const;
    const commandRequest = {
      ...identity,
      additionalPermissions: {
        fileSystem: {
          entries: [],
          globScanMaxDepth: null,
          read: ["/workspace/Codexly/src"],
          write: null,
        },
        network: { enabled: true },
      },
      availableDecisions: ["allow", "allow_for_session", "deny"],
      command: "pnpm check",
      cwd: "/workspace/Codexly",
      kind: "command",
      networkAccess: { host: "api.example.com", protocol: "https" },
      reason: "需要执行检查",
      type: "command_approval",
    } as const;
    const fileRequest = {
      ...identity,
      availableDecisions: ["allow", "deny"],
      grantRoot: "/workspace/Codexly",
      reason: null,
      requestId: "number:8",
      type: "file_change_approval",
    } as const;
    const inputRequest = {
      ...identity,
      questions: [
        {
          header: "执行模式",
          id: "mode",
          isOther: false,
          isSecret: false,
          options: [
            { description: "继续实现", label: "继续" },
            { description: "停止当前工作", label: "停止" },
          ],
          prompt: "下一步怎么处理？",
          type: "choice",
        },
      ],
      requestId: "string:input-1",
      type: "user_input",
    } as const;
    const permissionRequest = {
      ...identity,
      cwd: "/workspace/Codexly",
      environmentId: "local",
      permissions: {
        fileSystem: {
          entries: [
            {
              access: "write",
              path: { type: "glob", value: "/workspace/Codexly/*.log" },
            },
          ],
          globScanMaxDepth: 4,
          read: ["/workspace/Codexly/src"],
          write: ["/workspace/Codexly/.cache"],
        },
        network: { enabled: true },
      },
      reason: "需要安装依赖并写入缓存",
      requestId: "string:permissions-1",
      type: "permissions_approval",
    } as const;
    const elicitationRequest = {
      ...identity,
      fields: [
        {
          defaultValue: true,
          description: "允许工具继续执行",
          id: "confirmed",
          required: true,
          title: "确认",
          type: "boolean",
        },
      ],
      message: "Allow this request?",
      mode: "form",
      requestId: "string:elicitation-1",
      serverName: "example",
      type: "mcp_elicitation",
    } as const;

    expect(
      [commandRequest, fileRequest, inputRequest, permissionRequest, elicitationRequest].every(
        (request) => Value.Check(PendingRequestSchema, request),
      ),
    ).toBe(true);
    expect(
      Value.Check(PendingRequestSchema, {
        ...inputRequest,
        questions: [{ ...inputRequest.questions[0], options: [] }],
      }),
    ).toBe(false);
    expect(
      Value.Check(PendingRequestSchema, {
        ...inputRequest,
        questions: [
          {
            ...inputRequest.questions[0],
            isOther: true,
            type: "confirmation",
          },
        ],
      }),
    ).toBe(false);
    expect(Value.Check(PendingRequestSchema, { ...commandRequest, nativeRequestId: 7 })).toBe(
      false,
    );
    expect(
      Value.Check(PendingRequestSchema, {
        ...commandRequest,
        networkAccess: { host: "api.example.com", protocol: "ftp" },
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: commandRequest.itemId,
        projectId: commandRequest.projectId,
        resolution: { decision: "allow_for_session" },
        taskId: commandRequest.taskId,
        turnId: commandRequest.turnId,
        type: commandRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: permissionRequest.itemId,
        projectId: permissionRequest.projectId,
        resolution: { grantedPermissions: ["network"], scope: "session" },
        taskId: permissionRequest.taskId,
        turnId: permissionRequest.turnId,
        type: permissionRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: permissionRequest.itemId,
        projectId: permissionRequest.projectId,
        resolution: { grantedPermissions: ["network", "network"], scope: "turn" },
        taskId: permissionRequest.taskId,
        turnId: permissionRequest.turnId,
        type: permissionRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: elicitationRequest.itemId,
        projectId: elicitationRequest.projectId,
        resolution: { action: "accept", content: { confirmed: true } },
        taskId: elicitationRequest.taskId,
        turnId: elicitationRequest.turnId,
        type: elicitationRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: elicitationRequest.itemId,
        projectId: elicitationRequest.projectId,
        resolution: { action: "decline", content: null },
        taskId: elicitationRequest.taskId,
        turnId: elicitationRequest.turnId,
        type: elicitationRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: ["继续"] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: [""] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { answers: { mode: ["继续", "停止"] } },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: inputRequest.itemId,
        projectId: inputRequest.projectId,
        resolution: { decision: "allow" },
        taskId: inputRequest.taskId,
        turnId: inputRequest.turnId,
        type: inputRequest.type,
      }),
    ).toBe(false);
    expect(
      Value.Check(ResolvePendingRequestResponseSchema, {
        request: { ...commandRequest, status: "resolved" },
      }),
    ).toBe(true);
  });

  it("validates health and capability responses", () => {
    expect(Value.Check(HealthResponseSchema, { status: "ok", version: 1 })).toBe(true);
    expect(
      Value.Check(AgentCapabilitiesSchema, {
        feedback: { upload: true },
        goals: { clear: true, read: true, update: true },
        provider: "codex",
        skills: { list: true, use: true },
        tasks: { fork: true, list: true, read: true, start: true },
        turns: {
          compact: true,
          interrupt: true,
          review: true,
          start: true,
          steer: true,
        },
      }),
    ).toBe(true);
  });

  it("validates task command mutation contracts", () => {
    const task = {
      id: "task-2",
      pinned: false,
      projectId: "codexly",
      title: "续接任务",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    const turn = {
      completedAt: null,
      error: null,
      id: "review-turn",
      items: [],
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running",
    };

    expect(
      Value.Check(ReviewAgentTaskRequestSchema, {
        target: { type: "base_branch", branch: "main" },
      }),
    ).toBe(true);
    expect(Value.Check(ReviewAgentTaskRequestSchema, { target: { type: "base_branch" } })).toBe(
      false,
    );
    expect(Value.Check(ReviewAgentTaskResponseSchema, { taskId: "task-1", turn })).toBe(true);
    expect(Value.Check(CompactAgentTaskRequestSchema, {})).toBe(true);
    expect(
      Value.Check(CompactAgentTaskResponseSchema, { status: "compacting", taskId: "task-1" }),
    ).toBe(true);
    expect(Value.Check(ForkAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(ForkAgentTaskRequestSchema, { lastTurnId: "turn-1" })).toBe(true);
    expect(Value.Check(ForkAgentTaskRequestSchema, { lastTurnId: "" })).toBe(false);
    expect(Value.Check(ForkAgentTaskResponseSchema, { task })).toBe(true);
    expect(Value.Check(PinAgentTaskRequestSchema, { pinned: true })).toBe(true);
    expect(Value.Check(PinAgentTaskRequestSchema, { pinned: true, taskId: "task-2" })).toBe(false);
    expect(Value.Check(PinAgentTaskResponseSchema, { task: { ...task, pinned: true } })).toBe(true);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "重命名任务" })).toBe(true);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "   " })).toBe(false);
    expect(Value.Check(RenameAgentTaskRequestSchema, { title: "" })).toBe(false);
    expect(
      Value.Check(RenameAgentTaskResponseSchema, { task: { ...task, title: "重命名任务" } }),
    ).toBe(true);
    expect(Value.Check(ArchiveAgentTaskRequestSchema, {})).toBe(true);
    expect(Value.Check(ArchiveAgentTaskRequestSchema, { permanent: true })).toBe(false);
    expect(
      Value.Check(ArchiveAgentTaskResponseSchema, { status: "archived", taskId: "task-2" }),
    ).toBe(true);
    expect(
      Value.Check(UploadAgentFeedbackRequestSchema, {
        classification: "other",
        includeLogs: true,
        reason: "菜单操作不符合预期",
      }),
    ).toBe(true);
    expect(
      Value.Check(UploadAgentFeedbackResponseSchema, { status: "sent", taskId: "task-1" }),
    ).toBe(true);
  });
});
