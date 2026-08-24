import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  AgentGlobalSettingsResponseSchema,
  AgentGlobalSettingsSchema,
  AgentMessageItemSchema,
  AgentReviewItemSchema,
  AgentProjectDefaultsResponseSchema,
  AgentProjectDefaultsSchema,
  AgentTaskSettingsResponseSchema,
  AgentTaskSettingsSchema,
  AgentTaskSnapshotSchema,
} from "./project.js";

describe("project task snapshot protocol", () => {
  it("validates a structured task snapshot", () => {
    const snapshot = {
      contextUsage: null,
      id: "task-1",
      plan: {
        explanation: "按顺序执行并同步状态。",
        steps: [
          { status: "completed", text: "定义协议" },
          { status: "in_progress", text: "接入界面" },
          { status: "pending", text: "验证行为" },
        ],
      },
      pinned: false,
      pendingRequests: [],
      projectId: "code-agent",
      settings: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      status: "idle",
      title: "实现真实任务历史",
      turns: [
        {
          completedAt: "2026-07-23T00:01:00.000Z",
          error: null,
          id: "turn-1",
          items: [
            { id: "item-1", role: "user", text: "读取真实历史", type: "message" },
            {
              content: "按统一边界实现",
              id: "item-2",
              summary: "分析协议",
              type: "reasoning",
            },
            {
              command: "pnpm check",
              cwd: "/workspace/CodeAgent",
              id: "item-3",
              output: "Done",
              outputTruncated: false,
              status: "completed",
              type: "command",
            },
            {
              changes: [
                {
                  diff: "+export {}",
                  kind: "update",
                  path: "/workspace/CodeAgent/src/index.ts",
                },
              ],
              id: "item-4",
              status: "completed",
              type: "file_change",
            },
            {
              id: "item-5",
              input: { path: "src/index.ts" },
              name: "read_file",
              status: "completed",
              type: "tool",
            },
            { id: "item-6", text: "1. 定义协议", type: "plan" },
            {
              detail: "上下文已压缩",
              id: "item-7",
              label: "压缩上下文",
              transient: true,
              type: "activity",
            },
          ],
          startedAt: "2026-07-23T00:00:00.000Z",
          status: "completed",
        },
      ],
      turnsNextCursor: null,
      updatedAt: "2026-07-23T00:01:00.000Z",
    };

    expect(Value.Check(AgentTaskSnapshotSchema, snapshot)).toBe(true);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [{ ...snapshot.turns[0], error: undefined }],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [
          {
            ...snapshot.turns[0],
            items: snapshot.turns[0]?.items.map((item) =>
              item.type === "command" ? { ...item, outputTruncated: undefined } : item,
            ),
          },
        ],
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSnapshotSchema, {
        ...snapshot,
        turns: [{ ...snapshot.turns[0], status: "inProgress" }],
      }),
    ).toBe(false);
    expect(Value.Check(AgentTaskSnapshotSchema, { ...snapshot, nativeThread: {} })).toBe(false);
  });

  it("accepts user message skills without exposing native paths", () => {
    const message = {
      id: "message-1",
      role: "user",
      skills: [{ name: "review-security" }],
      text: "检查认证边界",
      type: "message",
    };

    expect(Value.Check(AgentMessageItemSchema, message)).toBe(true);
    expect(
      Value.Check(AgentMessageItemSchema, {
        ...message,
        skills: [{ name: "review-security", path: "/private/SKILL.md" }],
      }),
    ).toBe(false);
  });

  it("validates a structured review timeline item", () => {
    expect(
      Value.Check(AgentReviewItemSchema, {
        id: "review-turn-1",
        target: { type: "uncommitted_changes" },
        type: "review",
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentReviewItemSchema, {
        id: "review-turn-1",
        target: { type: "base_branch" },
        type: "review",
      }),
    ).toBe(false);
  });

  it("validates strict project defaults and task settings", () => {
    const projectDefaults = {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      fastMode: true,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };
    const taskSettings = {
      approvalPolicy: projectDefaults.approvalPolicy,
      approvalsReviewer: projectDefaults.approvalsReviewer,
      model: projectDefaults.model,
      reasoningEffort: projectDefaults.reasoningEffort,
      sandboxMode: projectDefaults.sandboxMode,
    };

    expect(Value.Check(AgentProjectDefaultsSchema, projectDefaults)).toBe(true);
    expect(Value.Check(AgentProjectDefaultsResponseSchema, { settings: projectDefaults })).toBe(
      true,
    );
    expect(Value.Check(AgentTaskSettingsSchema, taskSettings)).toBe(true);
    const granularApprovalPolicy = {
      granular: {
        mcp_elicitations: false,
        request_permissions: true,
        rules: false,
        sandbox_approval: true,
        skill_approval: false,
      },
    } as const;
    expect(
      Value.Check(AgentTaskSettingsSchema, {
        ...taskSettings,
        approvalPolicy: granularApprovalPolicy,
      }),
    ).toBe(true);
    expect(Value.Check(AgentTaskSettingsResponseSchema, { settings: taskSettings })).toBe(true);
    expect(Value.Check(AgentProjectDefaultsSchema, { ...projectDefaults, fastMode: "true" })).toBe(
      false,
    );
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, approvalPolicy: "always" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, approvalsReviewer: "always" }),
    ).toBe(false);
    expect(Value.Check(AgentTaskSettingsSchema, { ...taskSettings, approvalPolicy: "never" })).toBe(
      true,
    );
    const settingsWithoutReviewer = {
      approvalPolicy: taskSettings.approvalPolicy,
      model: taskSettings.model,
      reasoningEffort: taskSettings.reasoningEffort,
      sandboxMode: taskSettings.sandboxMode,
    };
    expect(Value.Check(AgentTaskSettingsSchema, settingsWithoutReviewer)).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, sandboxMode: "host-write" }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsSchema, { ...taskSettings, reasoningEffort: undefined }),
    ).toBe(false);
    expect(
      Value.Check(AgentTaskSettingsResponseSchema, { settings: taskSettings, legacy: true }),
    ).toBe(false);
  });

  it("validates strict global settings", () => {
    const settings = {
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      commitMessageModel: "gpt-5.6-terra",
      commitMessagePrompt: "突出说明用户可见影响。",
      defaultOpenAppId: "visual-studio-code",
      fastMode: false,
      followUpBehavior: "queue",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    };

    expect(Value.Check(AgentGlobalSettingsSchema, settings)).toBe(true);
    const granularApprovalPolicy = {
      granular: {
        mcp_elicitations: false,
        request_permissions: true,
        rules: false,
        sandbox_approval: true,
        skill_approval: false,
      },
    } as const;
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        approvalPolicy: granularApprovalPolicy,
      }),
    ).toBe(true);
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
      }),
    ).toBe(false);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, fastMode: true })).toBe(true);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, fastMode: "true" })).toBe(false);
    expect(Value.Check(AgentGlobalSettingsResponseSchema, { settings })).toBe(true);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, followUpBehavior: "steer" })).toBe(
      true,
    );
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, followUpBehavior: "later" })).toBe(
      false,
    );
    const settingsWithoutFollowUpBehavior = { ...settings };
    Reflect.deleteProperty(settingsWithoutFollowUpBehavior, "followUpBehavior");
    expect(Value.Check(AgentGlobalSettingsSchema, settingsWithoutFollowUpBehavior)).toBe(false);
    expect(Value.Check(AgentGlobalSettingsSchema, { ...settings, defaultOpenAppId: null })).toBe(
      true,
    );
    expect(
      Value.Check(AgentGlobalSettingsSchema, { ...settings, defaultOpenAppId: "system-default" }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, { ...settings, defaultOpenAppId: "unknown-app" }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
      }),
    ).toBe(true);
    expect(Value.Check(AgentGlobalSettingsResponseSchema, { settings, legacy: true })).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, { ...settings, commitMessageModel: undefined }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        commitMessageReasoningEffort: "medium",
      }),
    ).toBe(false);
    expect(
      Value.Check(AgentGlobalSettingsSchema, {
        ...settings,
        commitMessagePrompt: "x".repeat(4_001),
      }),
    ).toBe(false);
  });
});
