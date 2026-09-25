import { Value } from "@sinclair/typebox/value";
import { expect, test } from "vitest";
import { StartAgentTaskRequestSchema } from "./agent-actions.js";

test("task creation requires a bounded explicit idempotency key", () => {
  expect(Value.Check(StartAgentTaskRequestSchema, { idempotencyKey: "create-a" })).toBe(true);
  for (const request of [{}, { idempotencyKey: "" }, { idempotencyKey: " " }, { idempotencyKey: "x".repeat(129) }]) {
    expect(Value.Check(StartAgentTaskRequestSchema, request)).toBe(false);
  }
});
