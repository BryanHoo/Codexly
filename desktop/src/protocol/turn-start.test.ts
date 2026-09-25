import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";
import { StartAgentTurnRequestSchema } from "./agent-actions.js";

test("turn start requires an explicit bounded idempotency key", () => {
  const request = {
    input: { type: "prompt", text: "hello", attachments: [], skills: [] },
    options: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model-a", reasoningEffort: "high", sandboxMode: "workspace-write" },
  };
  expect(Value.Check(StartAgentTurnRequestSchema, { ...request, idempotencyKey: "turn-key" })).toBe(true);
  expect(Value.Check(StartAgentTurnRequestSchema, request)).toBe(false);
  for (const idempotencyKey of ["", " ", "x".repeat(129)]) {
    expect(Value.Check(StartAgentTurnRequestSchema, { ...request, idempotencyKey })).toBe(false);
  }
});
