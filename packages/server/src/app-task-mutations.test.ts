import type { AgentRuntimeProvider } from "@code-agent/core";
import type { AgentTurn } from "@code-agent/protocol";
import { describe, expect, it, vi } from "vitest";
import { createCodeAgentServer } from "./app.js";
import {
  project,
  temporaryProject,
  turnOptions,
  turnRequest,
  snapshot,
  closeCallbacks,
  createProvider,
  createSettingsRepository,
  createRuntimeConnectionMethods,
  createHarness,
} from "./app-all.test-support.js";

describe("server task mutations", () => {
  it("starts new tasks with project defaults and persists turn settings before Provider calls", async () => {
    const {
      app,
      readGlobalSettings,
      readProjectDefaults,
      readTaskSettings,
      startTask,
      startTurn,
      writeTaskSettings,
    } = await createHarness();
    readGlobalSettings.mockResolvedValue({
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      commitMessageModel: "gpt-5.6-sol",
      commitMessagePrompt: "",
      defaultOpenAppId: null,
      fastMode: true,
      followUpBehavior: "queue",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "workspace-write",
    });
    readProjectDefaults.mockResolvedValue({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      fastMode: false,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    readTaskSettings.mockResolvedValue({
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "danger-full-access",
    });

    const created = await app.inject({
      headers: { "idempotency-key": "new-task-defaults" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const turn = await app.inject({
      headers: { "idempotency-key": "persist-turn-settings" },
      method: "POST",
      payload: turnRequest("继续实现"),
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });

    expect(created.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledOnce();
    expect(writeTaskSettings).toHaveBeenCalledWith("code-agent", "task-1", {
      approvalPolicy: "never",
      approvalsReviewer: "user",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      sandboxMode: "read-only",
    });
    expect(turn.statusCode).toBe(201);
    expect(writeTaskSettings.mock.invocationCallOrder.at(-1)).toBeLessThan(
      startTurn.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("serves idempotent task and turn mutations", async () => {
    const { app, interruptTurn, readTask, startTask, startTurn, steerTurn } = await createHarness();
    const headers = { "idempotency-key": "mutation-1" };

    const created = await app.inject({
      headers,
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const repeated = await app.inject({
      headers,
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    });
    const turn = await app.inject({
      headers: { "idempotency-key": "turn-1" },
      method: "POST",
      payload: turnRequest("继续实现"),
      url: "/v1/projects/code-agent/tasks/task-1/turns",
    });
    const turnBody = turn.json<{ taskId: string; turn: AgentTurn }>();
    readTask.mockResolvedValueOnce({
      ...snapshot,
      status: "running",
      turns: [turnBody.turn],
    });
    const steered = await app.inject({
      headers: { "idempotency-key": "steer-1" },
      method: "POST",
      payload: {
        input: { attachments: [], skills: [], text: "优先修复测试", type: "prompt" },
        taskId: "task-1",
      },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/steer",
    });
    readTask.mockResolvedValueOnce({
      ...snapshot,
      status: "running",
      turns: [turnBody.turn],
    });
    const interrupted = await app.inject({
      headers: { "idempotency-key": "interrupt-1" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/interrupt",
    });

    expect(created.statusCode).toBe(201);
    expect(repeated.json()).toEqual(created.json());
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(turn.statusCode).toBe(201);
    expect(turn.json()).toMatchObject({ taskId: "task-1", turn: { id: "turn-1" } });
    expect(startTurn).toHaveBeenCalledWith(
      "task-1",
      { files: [], images: [], skills: [], text: "继续实现", textAttachments: [] },
      turnOptions,
    );
    expect(steered.statusCode).toBe(202);
    expect(steered.json()).toEqual({ status: "accepted", taskId: "task-1", turnId: "turn-1" });
    expect(steerTurn).toHaveBeenCalledWith("task-1", "turn-1", {
      files: [],
      images: [],
      skills: [],
      text: "优先修复测试",
      textAttachments: [],
    });
    expect(interrupted.statusCode).toBe(202);
    expect(interrupted.json()).toEqual({
      status: "interrupting",
      taskId: "task-1",
      turnId: "turn-1",
    });
    expect(interruptTurn).toHaveBeenCalledWith("task-1", "turn-1");

    readTask.mockResolvedValueOnce({
      ...snapshot,
      turns: [{ ...turnBody.turn, completedAt: "2026-07-23T00:03:00.000Z", status: "interrupted" }],
    });
    const replayedInterrupt = await app.inject({
      headers: { "idempotency-key": "interrupt-1" },
      method: "POST",
      payload: { taskId: "task-1" },
      url: "/v1/projects/code-agent/tasks/task-1/turns/turn-1/interrupt",
    });

    expect(replayedInterrupt.statusCode).toBe(202);
    expect(replayedInterrupt.json()).toEqual(interrupted.json());
    expect(interruptTurn).toHaveBeenCalledTimes(1);
  });

  it("serves the complete persistent task queue API", async () => {
    const { app, queue } = await createHarness();
    const baseUrl = "/v1/projects/code-agent/tasks/task-1/queue";
    const add = await app.inject({
      headers: { "idempotency-key": "queue-add-1" },
      method: "POST",
      payload: {
        clientUserMessageId: "client-message-1",
        input: { attachments: [], skills: [], text: "排队处理", type: "prompt" },
      },
      url: baseUrl,
    });
    const list = await app.inject({ method: "GET", url: baseUrl });
    const update = await app.inject({
      headers: { "idempotency-key": "queue-update-1" },
      method: "PUT",
      payload: {
        input: { attachments: [], skills: [], text: "更新内容", type: "prompt" },
      },
      url: `${baseUrl}/queue-1`,
    });
    const reorder = await app.inject({
      headers: { "idempotency-key": "queue-reorder-1" },
      method: "PUT",
      payload: { queuedSubmissionIds: ["queue-1"] },
      url: `${baseUrl}/reorder`,
    });
    const start = await app.inject({
      headers: { "idempotency-key": "queue-start-1" },
      method: "POST",
      payload: { queuedSubmissionId: "queue-1" },
      url: `${baseUrl}/start`,
    });
    const remove = await app.inject({
      headers: { "idempotency-key": "queue-delete-1" },
      method: "DELETE",
      url: `${baseUrl}/queue-1`,
    });

    expect(add.statusCode).toBe(201);
    expect(list.json()).toMatchObject({ data: [{ id: "queue-1", text: "排队处理" }] });
    expect(update.json()).toMatchObject({ queuedSubmission: { text: "更新内容" } });
    expect(reorder.json()).toEqual({ status: "reordered" });
    expect(start.json()).toMatchObject({ taskId: "task-1", turn: { id: "queued-turn" } });
    expect(remove.json()).toEqual({ deleted: true });
    expect(queue.add).toHaveBeenCalledOnce();
    expect(queue.list).toHaveBeenCalledWith("task-1", {});
    expect(queue.update).toHaveBeenCalledOnce();
    expect(queue.reorder).toHaveBeenCalledWith("task-1", ["queue-1"]);
    expect(queue.start).toHaveBeenCalledWith("task-1", "queue-1");
    expect(queue.delete).toHaveBeenCalledWith("task-1", "queue-1");
  });

  it("reconciles queued attachments after native queue changes", async () => {
    const { app, emitEvent, queue } = await createHarness();
    await app.inject({ method: "GET", url: "/v1/projects/code-agent/tasks/task-1/queue" });
    queue.list.mockClear();

    emitEvent({ payload: {}, taskId: "task-1", type: "queue.changed" });

    await vi.waitFor(() => {
      expect(queue.list).toHaveBeenCalledWith("task-1", { limit: 100 });
    });
  });

  it("reuses a created task when settings persistence is retried", async () => {
    const { app, startTask, writeTaskSettings } = await createHarness();
    writeTaskSettings.mockRejectedValueOnce(new Error("database unavailable"));
    const request = {
      headers: { "idempotency-key": "retry-task-settings" },
      method: "POST" as const,
      payload: {},
      url: "/v1/projects/code-agent/tasks",
    };

    const failed = await app.inject(request);
    const retried = await app.inject(request);

    expect(failed.statusCode).toBe(502);
    expect(retried.statusCode).toBe(201);
    expect(startTask).toHaveBeenCalledOnce();
    expect(writeTaskSettings).toHaveBeenCalledTimes(2);
  });

  it("serves idempotent task command mutations", async () => {
    const { app, compactTask, forkTask, startReview, uploadFeedback } = await createHarness();
    const reviewRequest = {
      headers: { "idempotency-key": "review-key" },
      method: "POST" as const,
      payload: { target: { type: "base_branch", branch: "main" } },
      url: "/v1/projects/code-agent/tasks/task-1/review",
    };

    const review = await app.inject(reviewRequest);
    const repeatedReview = await app.inject(reviewRequest);
    const compact = await app.inject({
      headers: { "idempotency-key": "compact-key" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/compact",
    });
    const fork = await app.inject({
      headers: { "idempotency-key": "fork-key" },
      method: "POST",
      payload: { lastTurnId: "turn-1" },
      url: "/v1/projects/code-agent/tasks/task-1/fork",
    });
    const feedback = await app.inject({
      headers: { "idempotency-key": "feedback-key" },
      method: "POST",
      payload: { classification: "other", includeLogs: true, reason: "体验反馈" },
      url: "/v1/projects/code-agent/tasks/task-1/feedback",
    });

    expect(review.statusCode, review.body).toBe(201);
    expect(repeatedReview.json()).toEqual(review.json());
    expect(review.json()).toMatchObject({ taskId: "task-1", turn: { id: "review-turn" } });
    expect(startReview).toHaveBeenCalledTimes(1);
    expect(startReview).toHaveBeenCalledWith("task-1", {
      branch: "main",
      type: "base_branch",
    });
    expect(compact.statusCode).toBe(202);
    expect(compact.json()).toEqual({ status: "compacting", taskId: "task-1" });
    expect(compactTask).toHaveBeenCalledWith("task-1");
    expect(fork.statusCode).toBe(201);
    expect(fork.json()).toMatchObject({ task: { id: "task-2" } });
    expect(forkTask).toHaveBeenCalledWith("task-1", "turn-1");
    expect(feedback.statusCode).toBe(200);
    expect(feedback.json()).toEqual({ status: "sent", taskId: "task-1" });
    expect(uploadFeedback).toHaveBeenCalledWith("task-1", {
      classification: "other",
      includeLogs: true,
      reason: "体验反馈",
    });
  });

  it("delegates task metadata and archive lifecycle mutations to the Provider", async () => {
    const { app, archiveTask, deleteTask, pinTask, renameTask, unarchiveTask } =
      await createHarness();

    const pinned = await app.inject({
      headers: { "idempotency-key": "pin-key" },
      method: "PUT",
      payload: { pinned: true },
      url: "/v1/projects/code-agent/tasks/task-1/pin",
    });
    const renamed = await app.inject({
      headers: { "idempotency-key": "rename-key" },
      method: "POST",
      payload: { title: "新的任务名称" },
      url: "/v1/projects/code-agent/tasks/task-1/rename",
    });
    const archived = await app.inject({
      headers: { "idempotency-key": "archive-key" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/archive",
    });
    const unarchived = await app.inject({
      headers: { "idempotency-key": "unarchive-key" },
      method: "POST",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1/unarchive",
    });
    const deleted = await app.inject({
      headers: { "idempotency-key": "delete-key" },
      method: "DELETE",
      payload: {},
      url: "/v1/projects/code-agent/tasks/task-1",
    });

    expect(pinned.statusCode, pinned.body).toBe(200);
    expect(pinned.json()).toMatchObject({ task: { id: "task-1", pinned: true } });
    expect(pinTask).toHaveBeenCalledWith("task-1", true);
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ task: { id: "task-1", title: "新的任务名称" } });
    expect(renameTask).toHaveBeenCalledWith("task-1", "新的任务名称");
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json()).toEqual({ status: "archived", taskId: "task-1" });
    expect(archiveTask).toHaveBeenCalledWith("task-1");
    expect(unarchived.statusCode, unarchived.body).toBe(200);
    expect(unarchived.json()).toMatchObject({ task: { id: "task-1" } });
    expect(unarchiveTask).toHaveBeenCalledWith("task-1");
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(deleted.json()).toEqual({ status: "deleted", taskId: "task-1" });
    expect(deleteTask).toHaveBeenCalledWith("task-1");
  });

  it("isolates idempotent task command results by project", async () => {
    const primary = createProvider();
    const secondary = createProvider();
    const otherProject = {
      ...project,
      id: "other-project",
      name: "Other Project",
      rootPath: "/workspace/OtherProject",
    };
    secondary.readTask.mockResolvedValue({ ...snapshot, projectId: otherProject.id });
    secondary.startReview.mockResolvedValue({
      completedAt: null,
      error: null,
      id: "other-review-turn",
      items: [],
      startedAt: "2026-07-26T00:00:00.000Z",
      status: "running",
    });
    const runtimeProvider: AgentRuntimeProvider = {
      ...createRuntimeConnectionMethods(),
      forProject: (activeProject) =>
        activeProject.id === otherProject.id ? secondary.provider : primary.provider,
      forTemporary: () => primary.provider,
      getCapabilities: () => primary.provider.getCapabilities(),
      listModels: () => primary.provider.listModels(),
      readDefaultSettings: () => Promise.resolve({}),
      releaseProject: () => Promise.resolve(),
    };
    const stateRepository = createSettingsRepository().repository;
    const app = await createCodeAgentServer({
      installAppUpdate: vi.fn(() => Promise.reject(new Error("No update available"))),
      projectRepository: {
        list: () => Promise.resolve([project, otherProject]),
        read: (projectId) =>
          Promise.resolve([project, otherProject].find((item) => item.id === projectId)),
        register: () => Promise.resolve(project),
        remove: () => Promise.resolve(false),
        rename: () => Promise.resolve(undefined),
        reorder: () => Promise.resolve([project, otherProject]),
      },
      providerConnectionRepository: stateRepository,
      provider: runtimeProvider,
      temporaryWorkspace: temporaryProject.rootPath,
      readAppInfo: vi.fn(() =>
        Promise.resolve({
          appVersion: "1.3.0",
          codexVersion: "0.149.0",
          latestVersion: "1.3.0",
          releaseNotes: null,
          status: "current" as const,
          updateAvailable: false,
        }),
      ),
      settingsRepository: stateRepository,
    });
    closeCallbacks.push(() => app.close());
    const request = {
      headers: { "idempotency-key": "shared-review-key" },
      method: "POST" as const,
      payload: { target: { type: "uncommitted_changes" } },
    };

    const first = await app.inject({
      ...request,
      url: "/v1/projects/code-agent/tasks/task-1/review",
    });
    const second = await app.inject({
      ...request,
      url: "/v1/projects/other-project/tasks/task-1/review",
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toMatchObject({ turn: { id: "other-review-turn" } });
    expect(primary.startReview).toHaveBeenCalledTimes(1);
    expect(secondary.startReview).toHaveBeenCalledTimes(1);
  });
});
