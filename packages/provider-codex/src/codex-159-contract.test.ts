import { describe, expect, it } from "vitest";

import { mapAgentTurn } from "./codex-protocol-mapping.js";
import { mapNotification } from "./codex-protocol-mapping.test-support.js";

describe("Codex 0.159 Guardian errors", () => {
  const nativeTurn = {
    id: "turn-1",
    status: "interrupted",
    items: [],
    startedAt: null,
    completedAt: null,
    error: {
      message: "Guardian denial limit reached",
      codexErrorInfo: "tooManyDenials",
      additionalDetails: null,
    },
  };

  it("preserves interruption diagnostics in history without changing the status", () => {
    const turn = mapAgentTurn(nativeTurn);
    expect(turn).toMatchObject({ status: "interrupted", error: nativeTurn.error.message });
  });

  it("delivers interruption diagnostics from turn/completed without a separate error event", () => {
    expect(
      mapNotification("turn/completed", { threadId: "task-1", turn: nativeTurn }),
    ).toMatchObject({
      type: "turn.completed",
      payload: { turn: { status: "interrupted", error: nativeTurn.error.message } },
    });
  });

  it("classifies the new error variant in the shared Web and desktop event schema", () => {
    const event = mapNotification("error", {
      threadId: "task-1",
      turnId: "turn-1",
      error: nativeTurn.error,
      willRetry: false,
    });
    expect(event).toMatchObject({
      type: "provider.error",
      payload: { code: "too_many_denials", willRetry: false },
    });
  });
});
