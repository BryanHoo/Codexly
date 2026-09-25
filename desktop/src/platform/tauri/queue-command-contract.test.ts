import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";

import {
  AgentQueuedSubmissionSnapshotSchema,
  MoveAgentQueuedSubmissionRequestSchema,
  MoveAgentQueuedSubmissionResponseSchema,
} from "@/protocol/index.js";

test("queue reads expose a complete snapshot without a frontend cursor", () => {
  expect(Value.Check(AgentQueuedSubmissionSnapshotSchema, { data: [] })).toBe(true);
  expect(Value.Check(AgentQueuedSubmissionSnapshotSchema, { data: [], nextCursor: "next" })).toBe(false);
  expect(Value.Check(AgentQueuedSubmissionSnapshotSchema, { data: [], nextCursor: null })).toBe(false);
});

test("queue moves accept only a single identity and adjacent direction", () => {
  for (const offset of [-1, 1]) {
    expect(Value.Check(MoveAgentQueuedSubmissionRequestSchema, { queuedSubmissionId: "queue-a", offset })).toBe(true);
  }
  for (const input of [
    { queuedSubmissionId: "queue-a", offset: 0 },
    { queuedSubmissionId: "queue-a", offset: 2 },
    { queuedSubmissionId: "", offset: 1 },
    { queuedSubmissionId: "queue-a", offset: -1, queuedSubmissionIds: ["queue-a"] },
    { queuedSubmissionIds: ["queue-a"] },
  ]) {
    expect(Value.Check(MoveAgentQueuedSubmissionRequestSchema, input)).toBe(false);
  }
  expect(Value.Check(MoveAgentQueuedSubmissionResponseSchema, { moved: true })).toBe(true);
  expect(Value.Check(MoveAgentQueuedSubmissionResponseSchema, { moved: false })).toBe(true);
  expect(Value.Check(MoveAgentQueuedSubmissionResponseSchema, { status: "reordered" })).toBe(false);
});
