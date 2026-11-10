import { it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  ToolApprovalPendingRequestSchema,
  ResolvePendingRequestRequestSchema,
} from "./pending-request.js";
it("权限原始选项和精确 optionId 通过公开 Schema，不改变旧审批请求", () => {
  const identity = { taskId: "task", projectId: "project", turnId: "turn", itemId: "item" };
  expect(
    Value.Check(ToolApprovalPendingRequestSchema, {
      ...identity,
      requestId: "request",
      type: "tool_approval",
      status: "pending",
      createdAt: new Date().toISOString(),
      expiresAt: null,
      availableDecisions: ["deny"],
      toolName: "工具",
      input: null,
      reason: null,
      acpOptions: [{ optionId: "permanent", name: "始终允许", kind: "allow_always" }],
    }),
  ).toBe(true);
  expect(
    Value.Check(ResolvePendingRequestRequestSchema, {
      ...identity,
      type: "tool_approval",
      resolution: { decision: "allow", optionId: "permanent" },
    }),
  ).toBe(true);
  expect(
    Value.Check(ResolvePendingRequestRequestSchema, {
      ...identity,
      type: "tool_approval",
      resolution: { decision: "allow" },
    }),
  ).toBe(true);
});
