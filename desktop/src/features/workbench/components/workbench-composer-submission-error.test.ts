import { describe, expect, it, vi } from "vitest";

import { NativeCommandError } from "../../../platform/tauri/native-client.js";
import {
  createComposerSubmission,
  findUnsupportedInputModality,
  toPromptSubmissionError,
} from "./workbench-composer-submission.js";

const activeSettings = {
  approvalPolicy: "never" as const,
  approvalsReviewer: "user" as const,
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write" as const,
};

const selectedModel = {
  defaultReasoningEffort: "high",
  description: "",
  displayName: "GPT",
  id: "gpt-5.6-sol",
  inputModalities: ["text", "image"],
  isDefault: true,
  supportedReasoningEfforts: [{ description: "", id: "high" }],
};

describe("toPromptSubmissionError", () => {
  it.each([
    ["GOAL_OBJECTIVE_REQUIRED", "composer.goalObjectiveRequired"],
    ["GOAL_OBJECTIVE_TOO_LONG", "composer.goalObjectiveTooLong"],
    ["GOAL_STRUCTURED_INPUT_UNSUPPORTED", "composer.goalStructuredInputUnsupported"],
  ])("renders the native Goal rejection %s", (code, key) => {
    expect(toPromptSubmissionError(new NativeCommandError(code, "native rejection"), (value) => value))
      .toMatchObject({ code, message: key });
  });

  it("maps a busy Codex thread to an actionable localized message", () => {
    const error = toPromptSubmissionError(
      new NativeCommandError(
        "CODEX_THREAD_BUSY",
        "Codex thread is active in another session",
      ),
      (key) => (key === "composer.threadBusy" ? "该任务正在另一个 Codex 会话中运行" : key),
    );

    expect(error.message).toBe("该任务正在另一个 Codex 会话中运行");
  });

  it("preserves ordinary Error instances", () => {
    const source = new Error("request timeout");

    expect(toPromptSubmissionError(source, (key) => key)).toBe(source);
  });
});

describe("findUnsupportedInputModality", () => {
  it("uses model/list input modalities for structured media", () => {
    expect(
      findUnsupportedInputModality(
        [{ kind: "image", mediaType: "image/png", name: "diagram.png" }],
        ["text"],
      ),
    ).toBe("image");
    expect(
      findUnsupportedInputModality(
        [{ kind: "file", mediaType: "audio/mpeg", name: "recording.mp3" }],
        ["text", "image"],
      ),
    ).toBe("audio");
    expect(
      findUnsupportedInputModality(
        [{ kind: "file", mediaType: "application/pdf", name: "report.pdf" }],
        ["text"],
      ),
    ).toBeUndefined();
  });
});

describe("createComposerSubmission", () => {
  it("passes Unicode Goal input to native validation without UTF-16 rejection", async () => {
    const capture = vi.fn(async () => undefined);
    const setMutationError = vi.fn();
    const submit = createComposerSubmission({
      activeSettings,
      selectedModel,
      selectedReasoningEffort: "high",
      composerMode: "goal",
      onCaptureSubmission: capture,
      turnControlsDisabled: false,
      fastMode: false,
      controller: {
        actionLock: { run: async (action: () => Promise<boolean>) => action() },
        isCurrentScope: () => true,
        setIsSubmitting: vi.fn(),
        setMutationError,
      },
    } as unknown as Parameters<typeof createComposerSubmission>[0]);
    const text = "🦀".repeat(4000);
    await expect(submit({ files: [], text }, [], { forceAction: "start" })).resolves.toBe(true);
    expect(capture).toHaveBeenCalledWith(
      { attachments: [], skills: [], text, type: "prompt" },
      expect.objectContaining({ goalMode: true }),
      [],
    );
    expect(setMutationError).toHaveBeenCalledExactlyOnceWith(null);
  });

  it.each([false, true])("clears an image-only steer without duplicating its projection (cleanupOnly: %s)", async (cleanupOnly) => {
    const clearComposerInput = vi.fn();
    const onSteerAccepted = vi.fn();
    const steerTurn = vi.fn(async () => ({
      ...(cleanupOnly ? { cleanupOnly: true } : {}),
      status: "accepted" as const,
      taskId: "task-a",
      turnId: "turn-a",
    }));
    const attachment = {
      detail: "auto" as const,
      id: "asset-a",
      kind: "image" as const,
      mediaType: "image/png",
      name: "diagram.png",
      size: 4,
    };
    const submit = createComposerSubmission({
      activeSettings,
      activeTaskId: "task-a",
      activeTurnId: "turn-a",
      activeUserMessageIds: [],
      canSteer: true,
      canSubmit: true,
      clearComposerInput,
      client: { steerTurn } as never,
      composerMode: undefined,
      controller: {
        actionLock: { run: async (action: () => Promise<unknown>) => action() },
        attachmentUploadPromises: { current: new Map() },
        interruptAttempt: { current: undefined },
        isCurrentScope: () => cleanupOnly,
        setIsSubmitting: vi.fn(),
        setMutationError: vi.fn(),
        setPendingTaskState: vi.fn(),
        setSubmittedTurnState: vi.fn(),
        startTaskAttempt: { current: undefined },
        startTurnAttempt: { current: undefined },
        steerTurnAttempt: { current: undefined },
        uploadAttempts: { current: new Map() },
        uploadedAttachments: { current: new Map() },
      } as never,
      fastMode: false,
      followUpBehavior: "steer",
      isCurrentSubmissionTarget: (projectId, taskId) =>
        projectId === "project-a" && taskId === "task-a",
      onCaptureSubmission: undefined,
      onDirectSubmission: vi.fn(),
      onGoalStarted: vi.fn(),
      onSteerAccepted,
      onTaskCreated: undefined,
      onTaskStarted: vi.fn(),
      onTurnStarted: undefined,
      pendingTask: undefined,
      projectId: "project-a",
      promptContent: [],
      routeScope: "project-a:draft:/workspace",
      saveQueuedSubmission: vi.fn(),
      selectedModel,
      selectedReasoningEffort: "high",
      skillEditorRef: { current: { getContent: () => [] } } as never,
      state: "running",
      taskId: "task-a",
      t: (key) => key,
      turnControlsDisabled: false,
    });

    await expect(
      submit({
        files: [
          {
            ...attachment,
            attachment,
            previewUrl: "asset://diagram.png",
            source: "host",
          },
        ],
        text: "",
      }),
    ).resolves.toBe(true);

    expect(steerTurn).toHaveBeenCalledOnce();
    expect(clearComposerInput).toHaveBeenCalledOnce();
    expect(onSteerAccepted).not.toHaveBeenCalled();
  });
});
