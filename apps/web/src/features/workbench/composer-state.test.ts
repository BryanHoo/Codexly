import { describe, expect, it, vi } from "vitest";

import {
  deriveComposerState,
  startPromptTurn,
  resolveComposerSubmitAction,
  resolveIdempotencyAttempt,
} from "./composer-state.js";

describe("Composer state", () => {
  it("derives connection and submission states without React state", () => {
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
    expect(deriveComposerState({ activeTurnId: undefined, connectionState: "reconnecting" })).toBe(
      "reconnecting",
    );
  });

  it("chooses follow-up behavior and reuses an unchanged idempotency attempt", () => {
    expect(resolveComposerSubmitAction("running", true, "queue", true)).toBe("queue");
    expect(resolveComposerSubmitAction("running", true, "steer", true)).toBe("steer");
    const createKey = vi.fn(() => "key-1");
    const attempt = resolveIdempotencyAttempt(undefined, "same", createKey);

    expect(resolveIdempotencyAttempt(attempt, "same", createKey)).toBe(attempt);
    expect(createKey).toHaveBeenCalledTimes(1);
  });
});

it.each(["codex", "claude"] as const)(
  "submits a new draft in its chosen worktree with %s settings",
  async (engine) => {
    const submitTask = vi
      .fn()
      .mockResolvedValue({ taskId: "task", turn: { id: "turn" }, checkpoint: { sequence: 1 } });
    const options = {
      approvalPolicy: "on-request" as const,
      approvalsReviewer: "user" as const,
      sandboxMode: "workspace-write" as const,
      model: "chosen-model",
      reasoningEffort: "high",
      ...(engine === "claude"
        ? { engineOptions: { engine, permissionMode: "default" as const } }
        : {}),
    };
    await startPromptTurn(
      { submitTask },
      {
        projectId: "project",
        workspacePath: "/repo/.worktree/topic",
        input: { type: "prompt", text: "hello", attachments: [], skills: [] },
        turnOptions: options,
        idempotencyKey: "submit",
      },
    );
    expect(submitTask.mock.calls[0]?.[1]).toEqual({
      type: "prompt",
      workspacePath: "/repo/.worktree/topic",
      input: { type: "prompt", text: "hello", attachments: [], skills: [] },
      options,
      ...(engine === "claude" ? { engine } : {}),
    });
  },
);
