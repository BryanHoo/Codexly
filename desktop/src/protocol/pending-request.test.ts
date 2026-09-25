import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";

import { PendingRequestSchema, ResolvePendingRequestRequestSchema } from "./pending-request.js";

const terminalInputRequest = {
  approvalId: "approval-stdin-a",
  availableDecisions: ["allow", "deny"],
  createdAt: "2026-08-31T08:00:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-a",
  processId: "42",
  projectId: "project-a",
  reason: "命令正在等待输入",
  requestId: "number:11",
  status: "pending",
  stdin: "yes\n",
  taskId: "thread-a",
  turnId: "turn-a",
  type: "terminal_input_approval",
} as const;

describe("terminal input approval schema", () => {
  it("accepts a structured writeStdin approval and its resolution", () => {
    expect(Value.Check(PendingRequestSchema, terminalInputRequest)).toBe(true);
    expect(
      Value.Check(ResolvePendingRequestRequestSchema, {
        itemId: "command-a",
        projectId: "project-a",
        resolution: { decision: "allow" },
        taskId: "thread-a",
        turnId: "turn-a",
        type: "terminal_input_approval",
      }),
    ).toBe(true);
  });

  it("rejects terminal input approvals without native identity or process metadata", () => {
    const { approvalId: _approvalId, ...withoutApprovalId } = terminalInputRequest;
    const { processId: _processId, ...withoutProcessId } = terminalInputRequest;
    expect(Value.Check(PendingRequestSchema, withoutApprovalId)).toBe(false);
    expect(Value.Check(PendingRequestSchema, withoutProcessId)).toBe(false);
  });
});
