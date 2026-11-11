import { expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ResolvePendingRequestRequestSchema, type PendingRequest } from "@/protocol/index.js";
import { TauriSidebarClient } from "./sidebar-client.js";
import type { InvokeImplementation } from "./native-client.js";

const request: Extract<PendingRequest, { type: "tool_approval" }> = {
  type: "tool_approval",
  requestId: "request",
  projectId: "project",
  taskId: "task",
  turnId: "turn",
  itemId: "item",
  createdAt: "2026-11-10T00:00:00Z",
  expiresAt: null,
  status: "pending",
  input: null,
  reason: null,
  toolName: "tool",
  availableDecisions: ["deny"],
  acpOptions: [{ optionId: "always", name: "原始授权", kind: "allow_always" }],
};
it("桌面审批 Schema 保留 ACP 原始 optionId", () => {
  expect(
    Value.Check(ResolvePendingRequestRequestSchema, {
      type: "tool_approval",
      projectId: "project",
      taskId: "task",
      turnId: "turn",
      itemId: "item",
      resolution: { decision: "allow", optionId: "always" },
    }),
  ).toBe(true);
});
it("真实原生客户端将 ACP 审批分流到共享宿主并保留幂等与完整身份", async () => {
  const response = { request: { ...request, status: "resolved" } };
  const invoke = vi.fn(async () => response),
    ensureRuntime = vi.fn();
  const client = new TauriSidebarClient({
    invoke: invoke as InvokeImplementation,
    connectEvents: () => Promise.resolve(),
    ensureRuntime,
  });
  expect(
    await client.resolvePendingRequest(
      request,
      { decision: "allow", optionId: "always" },
      { idempotencyKey: "approval-key" },
    ),
  ).toEqual(response);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("resolve_pending_request", {
    acp: true,
    request: {
      projectId: "project",
      taskId: "task",
      turnId: "turn",
      itemId: "item",
      requestId: "request",
      createdAt: request.createdAt,
    },
    resolution: { decision: "allow", optionId: "always" },
    idempotencyKey: "approval-key",
  });
  expect(ensureRuntime).not.toHaveBeenCalled();
});
