import { describe, expect, it, vi } from "vitest";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import { createPromptSkillContent } from "./prompt-skill-content.js";
import { createComposerSubmission } from "./workbench-composer-submission.js";

type ComposerSubmissionOptions = Parameters<typeof createComposerSubmission>[0];

const settings = {
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  model: "gpt-5.6-sol",
  reasoningEffort: "high",
  sandboxMode: "workspace-write",
} as const;

const model = {
  defaultReasoningEffort: "high",
  description: "适合复杂编码任务",
  displayName: "GPT-5.6 Sol",
  id: "gpt-5.6-sol",
  isDefault: true,
  supportedReasoningEfforts: [{ description: "深入分析", id: "high" }],
} as const;

const task = {
  id: "task-created",
  pinned: false,
  projectId: "codexly",
  title: "新任务",
  updatedAt: "2026-08-11T00:00:00.000Z",
} as const;

const turn: Awaited<ReturnType<ComposerSubmissionOptions["client"]["startTurn"]>>["turn"] = {
  completedAt: null,
  error: null,
  id: "turn-created",
  items: [],
  startedAt: "2026-08-11T00:00:00.000Z",
  status: "running",
};

function createHarness(overrides: Partial<ComposerSubmissionOptions> = {}) {
  const promptContent = overrides.promptContent ?? createPromptSkillContent("提交内容");
  const setIsSubmitting = vi.fn();
  const setMutationError = vi.fn();
  const setPendingTaskState = vi.fn();
  const setSubmittedTurnState = vi.fn();
  const startTask = vi.fn<ComposerSubmissionOptions["client"]["startTask"]>(() =>
    Promise.resolve({ task }),
  );
  const startTurn = vi.fn<ComposerSubmissionOptions["client"]["startTurn"]>(() =>
    Promise.resolve({ taskId: task.id, turn }),
  );
  const steerTurn = vi.fn<ComposerSubmissionOptions["client"]["steerTurn"]>(() =>
    Promise.resolve({ status: "accepted", taskId: "task-1", turnId: "turn-1" }),
  );
  const clearComposerInput = vi.fn();
  const saveQueuedSubmission = vi.fn(() => Promise.resolve(true));
  const skillEditor = {
    focus: vi.fn(),
    getContent: vi.fn(() => promptContent),
    replace: vi.fn(),
  };
  const controller = {
    actionLock: createAsyncActionLock(),
    isCurrentScope: vi.fn(() => true),
    setIsSubmitting,
    setMutationError,
    setPendingTaskState,
    setSubmittedTurnState,
    startTaskAttempt: { current: undefined },
    startTurnAttempt: { current: undefined },
    steerTurnAttempt: { current: undefined },
    uploadAttempts: { current: new Map() },
    uploadedAttachments: { current: new Map() },
  };
  const onTaskCreated = vi.fn();
  const onTaskStarted = vi.fn();
  const onTurnStarted = vi.fn();
  const options = {
    activeSettings: settings,
    activeTaskId: undefined,
    activeTurnId: undefined,
    canSteer: false,
    canSubmit: true,
    clearComposerInput,
    activeUserMessageIds: [],
    client: { startTask, startTurn, steerTurn },
    composerMode: undefined,
    controller,
    followUpBehavior: "queue",
    onDirectSubmission: vi.fn(),
    onGoalStarted: vi.fn(),
    onSteerAccepted: vi.fn(),
    onRequestNotificationPermission: vi.fn(),
    onTaskCreated,
    onTaskStarted,
    onTurnStarted,
    pendingTask: undefined,
    projectId: "codexly",
    promptContent,
    routeScope: "codexly:draft",
    selectedModel: model,
    selectedReasoningEffort: "high",
    saveQueuedSubmission,
    skillEditorRef: { current: skillEditor },
    state: "idle",
    taskId: undefined,
    t: (key: string) => key,
    turnControlsDisabled: false,
    ...overrides,
  } as ComposerSubmissionOptions;

  return {
    controller,
    clearComposerInput,
    onTaskCreated,
    onTaskStarted,
    onTurnStarted,
    saveQueuedSubmission,
    skillEditor,
    startTask,
    startTurn,
    steerTurn,
    submit: createComposerSubmission(options),
  };
}

describe("createComposerSubmission", () => {
  it("rejects an empty Goal objective before starting a mutation", async () => {
    const harness = createHarness({
      composerMode: "goal",
      promptContent: createPromptSkillContent("   "),
    });

    const submitted = await harness.submit({ files: [], text: "   " });

    expect(submitted).toBe(false);
    expect(harness.controller.setMutationError).toHaveBeenCalledWith(
      new Error("composer.goalObjectiveRequired"),
    );
    expect(harness.startTask).not.toHaveBeenCalled();
    expect(harness.startTurn).not.toHaveBeenCalled();
  });

  it("queues a follow-up and clears the active draft while a Turn is running", async () => {
    const onDirectSubmission = vi.fn();
    const harness = createHarness({
      activeTaskId: "task-1",
      activeTurnId: "turn-1",
      canSteer: true,
      onDirectSubmission,
      promptContent: createPromptSkillContent("排队处理"),
      state: "running",
      taskId: "task-1",
    });

    const submitted = await harness.submit({ files: [], text: "排队处理" });

    expect(submitted).toBe(true);
    expect(harness.saveQueuedSubmission).toHaveBeenCalledWith(
      { attachments: [], skills: [], text: "排队处理", type: "prompt" },
      expect.any(String),
    );
    expect(harness.clearComposerInput).toHaveBeenCalledOnce();
    expect(harness.startTurn).not.toHaveBeenCalled();
    expect(onDirectSubmission).not.toHaveBeenCalled();
  });

  it("keeps a directly accepted steer visible until the assistant responds", async () => {
    const onSteerAccepted = vi.fn();
    const harness = createHarness({
      activeTaskId: "task-1",
      activeTurnId: "turn-1",
      canSteer: true,
      followUpBehavior: "steer",
      onSteerAccepted,
      promptContent: createPromptSkillContent("补充失败测试"),
      state: "running",
      taskId: "task-1",
    });

    const submitted = await harness.submit({ files: [], text: "补充失败测试" });

    expect(submitted).toBe(true);
    expect(harness.steerTurn).toHaveBeenCalledOnce();
    expect(onSteerAccepted).toHaveBeenCalledWith({
      files: [],
      skills: [],
      text: "补充失败测试",
      turnId: "turn-1",
      userMessageIds: [],
    });
  });

  it("creates a new Task and starts its first Turn with one submission", async () => {
    const harness = createHarness();

    const submitted = await harness.submit({ files: [], text: "提交内容" });

    expect(submitted).toBe(true);
    const [startTaskProjectId, startTaskOptions] = harness.startTask.mock.calls[0] ?? [];
    expect(startTaskProjectId).toBe("codexly");
    expect(startTaskOptions?.idempotencyKey).toMatch(/\S/u);
    const [startTurnProjectId, startedTaskId, input, turnSettings, startTurnOptions] =
      harness.startTurn.mock.calls[0] ?? [];
    expect(startTurnProjectId).toBe("codexly");
    expect(startedTaskId).toBe(task.id);
    expect(input).toEqual({ attachments: [], skills: [], text: "提交内容", type: "prompt" });
    expect(turnSettings).toEqual(settings);
    expect(startTurnOptions?.idempotencyKey).toMatch(/\S/u);
    expect(harness.onTaskCreated).toHaveBeenCalledWith(task);
    expect(harness.onTurnStarted).toHaveBeenCalledWith(turn, expect.any(Object), []);
    expect(harness.onTaskStarted).toHaveBeenCalledWith(
      task,
      turn,
      expect.any(Object),
      settings,
      [],
    );
    expect(harness.controller.setSubmittedTurnState).toHaveBeenCalledWith({
      scope: "codexly:draft",
      turnId: turn.id,
    });
  });

  it("submits the live multiline editor text when the form value is stale", async () => {
    const harness = createHarness();
    harness.skillEditor.getContent.mockReturnValue(createPromptSkillContent("第一行\n第二行"));

    const submitted = await harness.submit({ files: [], text: "第一行" });

    expect(submitted).toBe(true);
    expect(harness.startTurn).toHaveBeenCalledWith(
      "codexly",
      task.id,
      { attachments: [], skills: [], text: "第一行\n第二行", type: "prompt" },
      settings,
      expect.any(Object),
    );
  });
});
