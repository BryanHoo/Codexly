import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";
import { StartAgentQueuedSubmissionRequestSchema, StartAgentQueuedSubmissionResponseSchema } from "./agent-actions.js";

test("queue cleanup response identifies the consumed item without inventing a turn", () => {
  const response = { cleanupOnly:true, taskId:"task", queuedSubmissionId:"queue" };
  expect(Value.Check(StartAgentQueuedSubmissionResponseSchema, response)).toBe(true);
  expect(Value.Check(StartAgentQueuedSubmissionResponseSchema, { ...response, turn:{} })).toBe(false);
  expect(Value.Check(StartAgentQueuedSubmissionResponseSchema, { cleanupOnly:true, taskId:"task" })).toBe(false);
});

test("queue start requires a key and scope while preserving next-item selection", () => {
  const request = { projectId:"project", taskId:"task", idempotencyKey:"key" };
  expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, request)).toBe(true);
  for (const queuedSubmissionId of [null, "queue-a"]) {
    expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, { ...request, queuedSubmissionId })).toBe(true);
  }
  for (const queuedSubmissionId of ["", "x".repeat(1025)]) {
    expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, { ...request, queuedSubmissionId })).toBe(false);
  }
  for (const idempotencyKey of [undefined, " ", "x".repeat(129)]) {
    expect(Value.Check(StartAgentQueuedSubmissionRequestSchema, { ...request, idempotencyKey })).toBe(false);
  }
});
