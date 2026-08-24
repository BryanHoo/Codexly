import { describe, expect, it, vi } from "vitest";
import {
  interruptPromptTurn,
  startPromptTurn,
  startTaskReview,
  steerPromptTurn,
} from "./workbench-composer.js";
import { task, turn } from "./workbench-composer.test-support.js";

describe("WorkbenchComposer submission", () => {
  it("creates a task before its first turn and continues existing tasks directly", async () => {
    const onTaskCreated = vi.fn();
    const client = {
      interruptTurn: vi.fn(),
      startTask: vi.fn(() => Promise.resolve({ task })),
      startTurn: vi.fn(() => {
        expect(onTaskCreated).toHaveBeenCalledWith(task);
        return Promise.resolve({ taskId: task.id, turn });
      }),
      uploadAttachment: vi.fn(),
    };

    await expect(
      startPromptTurn(client, {
        idempotencyKeys: { startTask: "task-key", startTurn: "turn-key" },
        input: { attachments: [], skills: [], text: "首次提交", type: "prompt" },
        onTaskCreated,
        projectId: "code-agent",
        turnOptions: {
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          sandboxMode: "workspace-write",
        },
      }),
    ).resolves.toEqual({ createdTask: task, taskId: task.id, turn });
    await expect(
      startPromptTurn(client, {
        idempotencyKeys: { startTurn: "existing-turn-key" },
        input: { attachments: [], skills: [], text: "继续任务", type: "prompt" },
        projectId: "code-agent",
        taskId: task.id,
        turnOptions: {
          approvalPolicy: "never",
          approvalsReviewer: "user",
          model: "gpt-5.6-terra",
          reasoningEffort: "low",
          sandboxMode: "danger-full-access",
        },
      }),
    ).resolves.toEqual({ taskId: task.id, turn });

    expect(client.startTask).toHaveBeenCalledTimes(1);
    expect(onTaskCreated).toHaveBeenCalledOnce();
    expect(client.startTask).toHaveBeenCalledWith("code-agent", { idempotencyKey: "task-key" });
    expect(client.startTurn).toHaveBeenNthCalledWith(
      1,
      "code-agent",
      task.id,
      {
        attachments: [],
        skills: [],
        text: "首次提交",
        type: "prompt",
      },
      {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        sandboxMode: "workspace-write",
      },
      { idempotencyKey: "turn-key" },
    );
    expect(client.startTurn).toHaveBeenNthCalledWith(
      2,
      "code-agent",
      task.id,
      {
        attachments: [],
        skills: [],
        text: "继续任务",
        type: "prompt",
      },
      {
        approvalPolicy: "never",
        approvalsReviewer: "user",
        model: "gpt-5.6-terra",
        reasoningEffort: "low",
        sandboxMode: "danger-full-access",
      },
      { idempotencyKey: "existing-turn-key" },
    );
  });

  it("starts code review from a new chat without creating message history", async () => {
    const calls: string[] = [];
    const reviewTurn = { ...turn, id: "review-turn" };
    const client = {
      startReview: vi.fn(() => {
        calls.push("review");
        return Promise.resolve({ taskId: task.id, turn: reviewTurn });
      }),
      startTask: vi.fn(() => {
        calls.push("task");
        return Promise.resolve({ task });
      }),
    };

    await expect(
      startTaskReview(client, {
        idempotencyKey: "review-key",
        projectId: "code-agent",
        target: { type: "uncommitted_changes" },
      }),
    ).resolves.toEqual({ createdTask: task, taskId: task.id, turn: reviewTurn });

    expect(calls).toEqual(["task", "review"]);
    expect(client.startTask).toHaveBeenCalledWith("code-agent", {
      idempotencyKey: "review-key",
    });
    expect(client.startReview).toHaveBeenCalledWith(
      "code-agent",
      task.id,
      { target: { type: "uncommitted_changes" } },
      { idempotencyKey: "review-key" },
    );

    await startTaskReview(client, {
      idempotencyKey: "base-review-key",
      projectId: "code-agent",
      target: { branch: "origin/main", type: "base_branch" },
      taskId: task.id,
    });
    expect(client.startReview).toHaveBeenLastCalledWith(
      "code-agent",
      task.id,
      { target: { branch: "origin/main", type: "base_branch" } },
      { idempotencyKey: "base-review-key" },
    );
  });

  it("interrupts the active turn through the client", async () => {
    const client = {
      interruptTurn: vi.fn(() =>
        Promise.resolve({ status: "interrupting" as const, taskId: task.id, turnId: turn.id }),
      ),
      startTask: vi.fn(),
      startTurn: vi.fn(),
      uploadAttachment: vi.fn(),
    };

    await expect(
      interruptPromptTurn(client, "code-agent", task.id, turn.id, "interrupt-key"),
    ).resolves.toMatchObject({
      status: "interrupting",
    });
    expect(client.interruptTurn).toHaveBeenCalledWith("code-agent", task.id, turn.id, {
      idempotencyKey: "interrupt-key",
    });
  });

  it("steers the active turn through the client", async () => {
    const client = {
      steerTurn: vi.fn(() =>
        Promise.resolve({ status: "accepted" as const, taskId: task.id, turnId: turn.id }),
      ),
    };
    const input = { attachments: [], skills: [], text: "补充约束", type: "prompt" as const };

    await expect(
      steerPromptTurn(client, "code-agent", task.id, turn.id, input, "steer-key"),
    ).resolves.toMatchObject({ status: "accepted" });
    expect(client.steerTurn).toHaveBeenCalledWith("code-agent", task.id, turn.id, input, {
      idempotencyKey: "steer-key",
    });
  });
});
