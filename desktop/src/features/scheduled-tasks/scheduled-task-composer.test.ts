import { describe, expect, it, vi } from "vitest";

import { createComposerSubmission } from "../workbench/components/workbench-composer-submission.js";

describe("scheduled task composer capture", () => {
  it("uploads attachments and captures the complete prompt options without starting a turn", async () => {
    const attachment = {
      id: "asset-a",
      kind: "file" as const,
      mediaType: "text/plain",
      name: "notes.txt",
      size: 4,
    };
    const client = {
      startTask: vi.fn(),
      startTurn: vi.fn(),
      uploadAttachment: vi.fn(async () => ({ attachment })),
    };
    const capture = vi.fn(async () => undefined);
    const controller = {
      actionLock: { run: async (action: () => Promise<unknown>) => action() },
      attachmentUploadPromises: { current: new Map() },
      interruptAttempt: { current: undefined },
      isCurrentScope: () => true,
      setIsSubmitting: vi.fn(),
      setMutationError: vi.fn(),
      setPendingTaskState: vi.fn(),
      setSubmittedTurnState: vi.fn(),
      startTaskAttempt: { current: undefined },
      startTurnAttempt: { current: undefined },
      steerTurnAttempt: { current: undefined },
      uploadAttempts: { current: new Map() },
      uploadedAttachments: { current: new Map() },
    };
    const submit = createComposerSubmission({
      activeSettings: {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      activeTaskId: undefined,
      activeTurnId: undefined,
      activeUserMessageIds: [],
      canSteer: false,
      canSubmit: false,
      clearComposerInput: vi.fn(),
      client: client as never,
      composerMode: "plan",
      controller: controller as never,
      fastMode: true,
      followUpBehavior: "queue",
      isCurrentSubmissionTarget: () => true,
      onCaptureSubmission: capture,
      onDirectSubmission: vi.fn(),
      onGoalStarted: vi.fn(),
      onSteerAccepted: vi.fn(),
      onTaskCreated: undefined,
      onTaskStarted: vi.fn(),
      onTurnStarted: undefined,
      pendingTask: undefined,
      projectId: "project-a",
      promptContent: [{ text: "Review", type: "text" }],
      routeScope: "schedule-a",
      saveQueuedSubmission: vi.fn(),
      selectedModel: {
        defaultReasoningEffort: "high",
        description: "",
        displayName: "GPT",
        id: "gpt-5.6-sol",
        inputModalities: ["text"],
        isDefault: true,
        supportedReasoningEfforts: [{ description: "", id: "high" }],
      },
      selectedReasoningEffort: "high",
      skillEditorRef: { current: { getContent: () => [{ text: "Review", type: "text" }] } } as never,
      state: "idle",
      t: (key) => key,
      taskId: undefined,
      turnControlsDisabled: false,
    });

    await expect(
      submit({
        files: [{ ...attachment, file: new File(["note"], "notes.txt"), previewUrl: "", source: "browser" }],
        text: "Review",
      }),
    ).resolves.toBe(true);
    expect(capture).toHaveBeenCalledWith(
      { attachments: [attachment], skills: [], text: "Review", type: "prompt" },
      expect.objectContaining({
        approvalPolicy: "never",
        collaborationMode: "plan",
        fastMode: true,
        model: "gpt-5.6-sol",
      }),
      [attachment],
    );
    expect(client.startTask).not.toHaveBeenCalled();
    expect(client.startTurn).not.toHaveBeenCalled();
  });
});
