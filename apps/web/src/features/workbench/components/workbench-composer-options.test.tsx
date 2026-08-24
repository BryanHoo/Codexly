import { describe, expect, it, vi } from "vitest";
import { changeAppLanguage } from "../../../i18n/i18n.js";
import {
  applyApprovalMode,
  createComposerTurnOptions,
  deriveComposerActions,
  deriveComposerInputAvailability,
  deriveComposerState,
  deriveApprovalMode,
  LARGE_PASTE_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_NAME,
  resolveIdempotencyAttempt,
  resolveActiveTurnId,
  resolveComposerSubmitAction,
  resolveComposerPlaceholder,
  resolveReasoningEffort,
  resolvePromptAttachment,
} from "./workbench-composer.js";
import { task, model, turn } from "./workbench-composer.test-support.js";

describe("WorkbenchComposer options", () => {
  it("uses concise placeholders for new and existing tasks", () => {
    expect(resolveComposerPlaceholder(undefined)).toBe("告诉 CodeAgent 你想完成什么");
    expect(resolveComposerPlaceholder("task-1")).toBe("输入后续要求");
  });

  it("adds plan mode only to the active Turn options", () => {
    expect(createComposerTurnOptions(task.settings, model.id, "high", "plan", false)).toEqual({
      ...task.settings,
      collaborationMode: "plan",
      model: model.id,
      reasoningEffort: "high",
    });
    expect(createComposerTurnOptions(task.settings, model.id, "high", undefined, false)).toEqual({
      ...task.settings,
      model: model.id,
      reasoningEffort: "high",
    });
  });

  it("adds goal mode only to the first Goal Turn options", () => {
    expect(createComposerTurnOptions(task.settings, model.id, "high", "goal", false)).toEqual({
      ...task.settings,
      goalMode: true,
      model: model.id,
      reasoningEffort: "high",
    });
  });

  it("adds fast mode only to the active Turn options", () => {
    expect(createComposerTurnOptions(task.settings, model.id, "high", undefined, true)).toEqual({
      ...task.settings,
      fastMode: true,
      model: model.id,
      reasoningEffort: "high",
    });
  });

  it("resolves Composer placeholders in English", async () => {
    await changeAppLanguage("en");
    try {
      expect(resolveComposerPlaceholder(undefined)).toBe(
        "Tell CodeAgent what you want to accomplish",
      );
      expect(resolveComposerPlaceholder("task-1")).toBe("Enter follow-up instructions");
    } finally {
      await changeAppLanguage("zh-CN");
    }
  });

  it("uses the official large-paste threshold and attachment name", () => {
    expect(LARGE_PASTE_CHARACTER_THRESHOLD).toBe(1_000);
    expect(PASTED_TEXT_ATTACHMENT_NAME).toBe("Pasted text.txt");
  });

  it("reuses an imported host attachment without uploading browser content again", async () => {
    const attachment = {
      id: "host-image",
      kind: "image" as const,
      mediaType: "image/png",
      name: "screen.png",
      size: 68,
    };
    const uploadBrowserAttachment = vi.fn();

    await expect(
      resolvePromptAttachment(
        {
          attachment,
          id: attachment.id,
          kind: attachment.kind,
          mediaType: attachment.mediaType,
          name: attachment.name,
          previewUrl: "/v1/projects/code-agent/files/image?path=screen.png",
          size: attachment.size,
          source: "host",
        },
        uploadBrowserAttachment,
      ),
    ).resolves.toEqual(attachment);
    expect(uploadBrowserAttachment).not.toHaveBeenCalled();
  });

  it("derives available actions from provider capabilities and task context", () => {
    const capabilities = {
      feedback: { upload: false },
      provider: "fake",
      skills: { list: false, use: false },
      tasks: { fork: false, list: true, read: true, start: false },
      turns: {
        compact: false,
        interrupt: false,
        review: false,
        start: true,
        steer: false,
      },
    };

    expect(deriveComposerActions(undefined, false)).toEqual({
      canInterrupt: false,
      canSubmit: false,
      canSteer: false,
    });
    expect(deriveComposerActions(capabilities, false)).toEqual({
      canInterrupt: false,
      canSubmit: false,
      canSteer: false,
    });
    expect(deriveComposerActions(capabilities, true)).toEqual({
      canInterrupt: false,
      canSubmit: true,
      canSteer: false,
    });
  });

  it("routes active-turn submissions to steer or queue while preserving interrupt", () => {
    expect(resolveComposerSubmitAction("idle", true, "queue", true)).toBe("start");
    expect(resolveComposerSubmitAction("running", false, "queue", true)).toBe("interrupt");
    expect(resolveComposerSubmitAction("running", true, "queue", true)).toBe("queue");
    expect(resolveComposerSubmitAction("running", true, "steer", true)).toBe("steer");
    expect(resolveComposerSubmitAction("running", true, "steer", false)).toBe("blocked");
  });

  it("derives all mutation states from runtime and local state", () => {
    expect(deriveComposerState({ activeTurnId: undefined, connectionState: "connected" })).toBe(
      "idle",
    );
    expect(
      deriveComposerState({
        activeTurnId: undefined,
        connectionState: "connected",
        isSubmitting: true,
      }),
    ).toBe("submitting");
    expect(deriveComposerState({ activeTurnId: "turn-1", connectionState: "connected" })).toBe(
      "running",
    );
    expect(deriveComposerState({ activeTurnId: "turn-1", connectionState: "reconnecting" })).toBe(
      "reconnecting",
    );
    expect(deriveComposerState({ activeTurnId: undefined, connectionState: "closed" })).toBe(
      "reconnecting",
    );
    expect(
      deriveComposerState({
        activeTurnId: undefined,
        connectionState: "connected",
        mutationFailed: true,
      }),
    ).toBe("failed");
    expect(resolveActiveTurnId({ ...task, status: "running", turns: [turn] }, turn.id)).toBe(
      turn.id,
    );
    expect(
      resolveActiveTurnId(
        {
          ...task,
          status: "idle",
          turns: [{ ...turn, completedAt: "2026-07-23T00:01:00.000Z", status: "completed" }],
        },
        turn.id,
      ),
    ).toBeUndefined();
  });

  it("keeps local draft and attachment input available while the runtime reconnects", () => {
    expect(deriveComposerInputAvailability("reconnecting")).toEqual({
      attachmentsDisabled: false,
      draftInputDisabled: false,
      turnControlsDisabled: true,
    });
    expect(deriveComposerInputAvailability("submitting")).toEqual({
      attachmentsDisabled: true,
      draftInputDisabled: true,
      turnControlsDisabled: true,
    });
  });

  it("reuses an idempotency key until the mutation fingerprint changes", () => {
    const createKey = vi.fn().mockReturnValueOnce("key-1").mockReturnValueOnce("key-2");
    const first = resolveIdempotencyAttempt(undefined, "start-turn:task-1:首次提交", createKey);
    const retried = resolveIdempotencyAttempt(first, "start-turn:task-1:首次提交", createKey);
    const changed = resolveIdempotencyAttempt(retried, "start-turn:task-1:修改后提交", createKey);

    expect(retried).toBe(first);
    expect(changed).toEqual({ fingerprint: "start-turn:task-1:修改后提交", key: "key-2" });
    expect(createKey).toHaveBeenCalledTimes(2);
  });

  it("resolves model reasoning effort", () => {
    expect(resolveReasoningEffort(model, "low")).toBe("low");
    expect(resolveReasoningEffort(model, "unsupported")).toBe("high");
    expect(resolveReasoningEffort(undefined, "high")).toBeUndefined();
  });

  it("仅将 CLI 审批策略暴露给任务编辑器", () => {
    const granularSettings = {
      ...task.settings,
      approvalPolicy: {
        granular: {
          mcp_elicitations: true,
          request_permissions: true,
          rules: true,
          sandbox_approval: true,
          skill_approval: true,
        },
      },
    } as const;

    expect(deriveApprovalMode({ ...task.settings, approvalPolicy: "untrusted" })).toBe(
      "on-request",
    );
    expect(deriveApprovalMode(granularSettings)).toBe("on-request");
    expect(
      applyApprovalMode({ ...task.settings, approvalsReviewer: "auto_review" }, "never"),
    ).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
  });

  it("互斥切换自动审核且不修改沙盒", () => {
    const automatic = applyApprovalMode(
      { ...task.settings, sandboxMode: "read-only" },
      "auto-review",
    );

    expect(automatic).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      sandboxMode: "read-only",
    });
    expect(deriveApprovalMode(automatic)).toBe("auto-review");
    expect({ ...automatic, sandboxMode: "danger-full-access" }).toMatchObject({
      approvalsReviewer: "auto_review",
      sandboxMode: "danger-full-access",
    });
  });
});
