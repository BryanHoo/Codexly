import { describe, expect, it, vi } from "vitest";
import {
  startPromptTurn,
  startTaskReview,
  interruptPromptTurn,
  steerPromptTurn,
} from "./workbench-composer.js";
import { task, turn } from "./workbench-composer.test-support.js";

describe("WorkbenchComposer submission", () => {
  const checkpoint = { sequence: 0, sessionId: "session-1" };
  const input = { attachments: [], skills: [], text: "首次提交", type: "prompt" as const };
  const turnOptions = {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
  } as const;

  it("sends one business request and publishes the returned task", async () => {
    const onTaskCreated = vi.fn();
    const client = {
      submitTask: vi.fn(() =>
        Promise.resolve({ checkpoint, createdTask: task, taskId: task.id, turn }),
      ),
    };
    await startPromptTurn(client, {
      idempotencyKey: "submit-key",
      input,
      turnOptions,
      onTaskCreated,
      projectId: "codexly",
    });
    expect(client.submitTask).toHaveBeenCalledExactlyOnceWith(
      "codexly",
      { type: "prompt", input, options: turnOptions },
      { idempotencyKey: "submit-key" },
    );
    expect(onTaskCreated).toHaveBeenCalledExactlyOnceWith(task);
  });

  it("preserves request identity on failure without creating a task in the browser", async () => {
    const onTaskCreated = vi.fn();
    const client = {
      submitTask: vi
        .fn()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockResolvedValueOnce({ checkpoint, createdTask: task, taskId: task.id, turn }),
    };
    const options = {
      idempotencyKey: "same-key",
      input,
      turnOptions,
      onTaskCreated,
      projectId: "codexly",
    };
    await expect(startPromptTurn(client, options)).rejects.toThrow("unavailable");
    expect(onTaskCreated).not.toHaveBeenCalled();
    await startPromptTurn(client, options);
    expect(client.submitTask.mock.calls[0]).toEqual(client.submitTask.mock.calls[1]);
  });

  it("submits review intent with the existing task when selected", async () => {
    const client = {
      submitTask: vi.fn(() => Promise.resolve({ checkpoint, taskId: task.id, turn })),
    };
    await startTaskReview(client, {
      idempotencyKey: "review-key",
      projectId: "codexly",
      taskId: task.id,
      target: { type: "uncommitted_changes" },
    });
    expect(client.submitTask).toHaveBeenCalledExactlyOnceWith(
      "codexly",
      { type: "review", taskId: task.id, target: { type: "uncommitted_changes" } },
      { idempotencyKey: "review-key" },
    );
  });

  it("keeps explicit interrupt and steer actions", async () => {
    const client = { interruptTurn: vi.fn(), steerTurn: vi.fn() };
    await interruptPromptTurn(client, "codexly", task.id, turn.id, "interrupt-key");
    await steerPromptTurn(client, "codexly", task.id, turn.id, input, "steer-key");
    expect(client.interruptTurn).toHaveBeenCalledWith("codexly", task.id, turn.id, {
      idempotencyKey: "interrupt-key",
    });
    expect(client.steerTurn).toHaveBeenCalledWith("codexly", task.id, turn.id, input, {
      idempotencyKey: "steer-key",
    });
  });
});
