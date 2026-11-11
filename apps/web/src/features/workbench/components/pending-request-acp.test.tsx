import type { PendingRequest } from "@codexly/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PendingRequestCard } from "./pending-request.js";

it("ACP 审批使用原始名称和选项顺序，不折叠为旧的允许/拒绝", () => {
  const request: Extract<PendingRequest, { type: "tool_approval" }> = {
    type: "tool_approval",
    requestId: "request",
    projectId: "project",
    taskId: "task",
    turnId: "turn",
    itemId: "item",
    status: "pending",
    createdAt: "2026-11-10T00:00:00Z",
    expiresAt: null,
    toolName: "检查文件",
    input: { path: "src/index.ts" },
    reason: null,
    availableDecisions: ["deny"],
    acpOptions: [
      { optionId: "forever", name: "持续允许检查", kind: "allow_always" },
      { optionId: "no", name: "拒绝这次检查", kind: "reject_once" },
    ],
  };
  const markup = renderToStaticMarkup(
    <PendingRequestCard request={request} interactive onResolve={vi.fn()} />,
  );
  expect(markup).toContain("持续允许检查");
  expect(markup).toContain("拒绝这次检查");
  expect(markup.indexOf("持续允许检查")).toBeLessThan(markup.indexOf("拒绝这次检查"));
  expect(markup).not.toMatch(/>拒绝<\/button>/);
});
