import { describe, expect, it, vi } from "vitest";
import type { AgentPromptInput } from "@code-agent/protocol";
import { CodeAgentClient } from "./http-client.js";
import {
  task,
  skill,
  pixelBytes,
  attachment,
  pendingRequest,
  jsonResponse,
} from "./http-client.test-support.js";

describe("CodeAgentClient task mutations", () => {
  it("sends typed task and turn mutations with idempotency keys", async () => {
    const runningTurn = {
      completedAt: null,
      error: null,
      id: "turn-1",
      items: [],
      startedAt: "2026-07-23T00:02:00.000Z",
      status: "running",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ task }))
      .mockResolvedValueOnce(jsonResponse({ attachment }))
      .mockResolvedValueOnce(jsonResponse({ taskId: task.id, turn: runningTurn }))
      .mockResolvedValueOnce(
        jsonResponse({ status: "accepted", taskId: task.id, turnId: runningTurn.id }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ status: "interrupting", taskId: task.id, turnId: runningTurn.id }),
      );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.startTask("code-agent", { idempotencyKey: "task-key" });
    await client.uploadAttachment(
      "code-agent",
      {
        content: new Blob([pixelBytes], { type: "image/png" }),
        kind: "image",
        name: attachment.name,
      },
      { idempotencyKey: "attachment-key" },
    );
    await client.startTurn(
      "code-agent",
      task.id,
      {
        attachments: [{ id: attachment.id }],
        skills: [{ id: skill.id, name: skill.name }],
        text: "继续实现",
        type: "prompt",
      },
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "read-only",
      },
      { idempotencyKey: "turn-key" },
    );
    await client.steerTurn(
      "code-agent",
      task.id,
      runningTurn.id,
      { attachments: [], skills: [], text: "优先修复测试", type: "prompt" },
      { idempotencyKey: "steer-key" },
    );
    await client.interruptTurn("code-agent", task.id, runningTurn.id, {
      idempotencyKey: "interrupt-key",
    });
    const [taskCall, attachmentCall, turnCall, steerCall, interruptCall] = fetchMock.mock.calls;
    expect(taskCall?.[0]).toBe("/v1/projects/code-agent/tasks");
    expect(taskCall?.[1]).toMatchObject({ body: "{}", method: "POST" });
    expect(new Headers(taskCall?.[1]?.headers).get("idempotency-key")).toBe("task-key");
    expect(attachmentCall?.[0]).toBe("/v1/projects/code-agent/attachments/image");
    expect(attachmentCall?.[1]).toMatchObject({
      method: "POST",
    });
    expect(attachmentCall?.[1]?.body).toBeInstanceOf(FormData);
    const attachmentForm = attachmentCall?.[1]?.body as FormData;
    const attachmentFile = attachmentForm.get("attachment");
    expect(attachmentFile).toBeInstanceOf(File);
    expect(attachmentFile).toMatchObject({ name: "screen.png", size: 68, type: "image/png" });
    expect(new Headers(attachmentCall?.[1]?.headers).has("content-type")).toBe(false);
    expect(new Headers(attachmentCall?.[1]?.headers).get("idempotency-key")).toBe("attachment-key");
    expect(turnCall?.[0]).toBe("/v1/projects/code-agent/tasks/task-1/turns");
    expect(turnCall?.[1]).toMatchObject({
      body: JSON.stringify({
        input: {
          attachments: [{ id: "attachment-1" }],
          skills: [{ id: "skill_01J00000000000000000000000", name: "review-security" }],
          text: "继续实现",
          type: "prompt",
        },
        options: {
          approvalPolicy: "on-request",
          approvalsReviewer: "auto_review",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "read-only",
        },
      }),
      method: "POST",
    });
    expect(steerCall?.[0]).toBe("/v1/projects/code-agent/tasks/task-1/turns/turn-1/steer");
    expect(steerCall?.[1]).toMatchObject({
      body: JSON.stringify({
        input: { attachments: [], skills: [], text: "优先修复测试", type: "prompt" },
        taskId: "task-1",
      }),
      method: "POST",
    });
    expect(new Headers(steerCall?.[1]?.headers).get("idempotency-key")).toBe("steer-key");
    expect(new Headers(turnCall?.[1]?.headers).get("idempotency-key")).toBe("turn-key");
    expect(interruptCall?.[0]).toBe("/v1/projects/code-agent/tasks/task-1/turns/turn-1/interrupt");
    expect(interruptCall?.[1]).toMatchObject({
      body: JSON.stringify({ taskId: "task-1" }),
      method: "POST",
    });
    expect(new Headers(interruptCall?.[1]?.headers).get("idempotency-key")).toBe("interrupt-key");
  });

  it("sends typed task command mutations with idempotency keys", async () => {
    const reviewTurn = {
      completedAt: null,
      error: null,
      id: "review-turn",
      items: [],
      startedAt: "2026-07-25T00:00:00.000Z",
      status: "running",
    };
    const forkedTask = { ...task, id: "task-2", title: "续接任务" };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ taskId: task.id, turn: reviewTurn }))
      .mockResolvedValueOnce(jsonResponse({ status: "compacting", taskId: task.id }))
      .mockResolvedValueOnce(jsonResponse({ task: forkedTask }))
      .mockResolvedValueOnce(jsonResponse({ status: "sent", taskId: task.id }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await client.startReview(
      "code-agent",
      task.id,
      { target: { type: "uncommitted_changes" } },
      { idempotencyKey: "review-key" },
    );
    await client.compactTask("code-agent", task.id, { idempotencyKey: "compact-key" });
    await client.forkTask(
      "code-agent",
      task.id,
      { lastTurnId: "turn-1" },
      { idempotencyKey: "fork-key" },
    );
    await client.uploadFeedback(
      "code-agent",
      task.id,
      { classification: "other", includeLogs: true, reason: "体验反馈" },
      { idempotencyKey: "feedback-key" },
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/projects/code-agent/tasks/task-1/review",
      "/v1/projects/code-agent/tasks/task-1/compact",
      "/v1/projects/code-agent/tasks/task-1/fork",
      "/v1/projects/code-agent/tasks/task-1/feedback",
    ]);
    expect(
      fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get("idempotency-key")),
    ).toEqual(["review-key", "compact-key", "fork-key", "feedback-key"]);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ lastTurnId: "turn-1" }));
  });

  it("sends and validates the complete task queue API", async () => {
    const queuedSubmission = {
      attachments: [],
      clientUserMessageId: "client-message-1",
      id: "queue-1",
      skills: [],
      text: "排队处理",
    };
    const queuedTurn = {
      completedAt: null,
      error: null,
      id: "turn-queued",
      items: [],
      startedAt: null,
      status: "running",
    };
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [queuedSubmission], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ queuedSubmission }))
      .mockResolvedValueOnce(
        jsonResponse({ queuedSubmission: { ...queuedSubmission, text: "更新内容" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: "reordered" }))
      .mockResolvedValueOnce(jsonResponse({ taskId: task.id, turn: queuedTurn }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));
    const client = new CodeAgentClient({ fetch: fetchMock });
    const input: AgentPromptInput = {
      attachments: [],
      skills: [],
      text: "排队处理",
      type: "prompt",
    };

    await client.listQueuedSubmissions("code-agent", task.id);
    await client.addQueuedSubmission("code-agent", task.id, input, "client-message-1", {
      idempotencyKey: "queue-add-key",
    });
    await client.updateQueuedSubmission("code-agent", task.id, "queue-1", input, {
      idempotencyKey: "queue-update-key",
    });
    await client.reorderQueuedSubmissions("code-agent", task.id, ["queue-1"], {
      idempotencyKey: "queue-reorder-key",
    });
    await client.startQueuedSubmission("code-agent", task.id, "queue-1", {
      idempotencyKey: "queue-start-key",
    });
    await client.deleteQueuedSubmission("code-agent", task.id, "queue-1", {
      idempotencyKey: "queue-delete-key",
    });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/projects/code-agent/tasks/task-1/queue",
      "/v1/projects/code-agent/tasks/task-1/queue",
      "/v1/projects/code-agent/tasks/task-1/queue/queue-1",
      "/v1/projects/code-agent/tasks/task-1/queue/reorder",
      "/v1/projects/code-agent/tasks/task-1/queue/start",
      "/v1/projects/code-agent/tasks/task-1/queue/queue-1",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      undefined,
      "POST",
      "PUT",
      "PUT",
      "POST",
      "DELETE",
    ]);
  });

  it("sends typed task metadata mutations with idempotency keys", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ task: { ...task, pinned: true } }))
      .mockResolvedValueOnce(jsonResponse({ task: { ...task, title: "新的任务名称" } }))
      .mockResolvedValueOnce(jsonResponse({ status: "archived", taskId: task.id }))
      .mockResolvedValueOnce(jsonResponse({ task }))
      .mockResolvedValueOnce(jsonResponse({ status: "deleted", taskId: task.id }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.pinTask("code-agent", task.id, true, { idempotencyKey: "pin-key" }),
    ).resolves.toMatchObject({ task: { pinned: true } });
    await expect(
      client.renameTask("code-agent", task.id, "新的任务名称", {
        idempotencyKey: "rename-key",
      }),
    ).resolves.toMatchObject({ task: { title: "新的任务名称" } });
    await expect(
      client.archiveTask("code-agent", task.id, { idempotencyKey: "archive-key" }),
    ).resolves.toEqual({ status: "archived", taskId: task.id });
    await expect(
      client.unarchiveTask("code-agent", task.id, { idempotencyKey: "unarchive-key" }),
    ).resolves.toEqual({ task });
    await expect(
      client.deleteTask("code-agent", task.id, { idempotencyKey: "delete-key" }),
    ).resolves.toEqual({ status: "deleted", taskId: task.id });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/projects/code-agent/tasks/task-1/pin",
      "/v1/projects/code-agent/tasks/task-1/rename",
      "/v1/projects/code-agent/tasks/task-1/archive",
      "/v1/projects/code-agent/tasks/task-1/unarchive",
      "/v1/projects/code-agent/tasks/task-1",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      "PUT",
      "POST",
      "POST",
      "POST",
      "DELETE",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      JSON.stringify({ pinned: true }),
      JSON.stringify({ title: "新的任务名称" }),
      "{}",
      "{}",
      "{}",
    ]);
    expect(
      fetchMock.mock.calls.map((call) => new Headers(call[1]?.headers).get("idempotency-key")),
    ).toEqual(["pin-key", "rename-key", "archive-key", "unarchive-key", "delete-key"]);
  });

  it("requests best-effort task unsubscribe without an idempotency cache entry", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "unsubscribed", taskId: task.id }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.unsubscribeTask("code-agent", task.id)).resolves.toEqual({
      status: "unsubscribed",
      taskId: task.id,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/projects/code-agent/tasks/task-1/unsubscribe",
      expect.objectContaining({ body: "{}", method: "POST" }),
    );
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("idempotency-key")).toBe(false);
  });

  it("sends typed pending request resolutions with full identity", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ request: { ...pendingRequest, status: "resolved" } }),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.resolvePendingRequest(
        pendingRequest,
        { decision: "allow" },
        { idempotencyKey: "resolve-key" },
      ),
    ).resolves.toMatchObject({ request: { status: "resolved" } });

    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(
      "/v1/projects/code-agent/tasks/task-1/pending-requests/number%3A7/resolve",
    );
    expect(call?.[1]).toMatchObject({
      body: JSON.stringify({
        itemId: "command-1",
        projectId: "code-agent",
        resolution: { decision: "allow" },
        taskId: "task-1",
        turnId: "turn-1",
        type: "command_approval",
      }),
      method: "POST",
    });
    expect(new Headers(call?.[1]?.headers).get("idempotency-key")).toBe("resolve-key");
  });
});
