import { describe, expect, it, vi } from "vitest";

import {
  deriveComposerState,
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
