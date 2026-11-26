import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { PendingRequest } from "@codexly/protocol";
import { PendingRequestCard as WebCard } from "../../../apps/web/src/features/workbench/components/pending-request.js";
import { PendingRequestCard as DesktopCard } from "../../src/features/workbench/components/pending-request.js";
import "../../src/shared/styles/globals.css";

vi.mock("../../../apps/web/src/features/notifications/action-notifications.js", () => ({
  notifyActionSuccess: vi.fn(),
  notifyActionError: vi.fn(),
}));
vi.mock("../../src/features/notifications/action-notifications.js", () => ({
  notifyActionSuccess: vi.fn(),
  notifyActionError: vi.fn(),
}));

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
  availableDecisions: ["allow", "deny"],
  acpOptions: [
    { optionId: "once-a", name: "仅读取这个文件", kind: "allow_once" },
    { optionId: "once-b", name: "另一个单次选择", kind: "allow_once" },
    { optionId: "always-a", name: "始终允许此操作", kind: "allow_always" },
    { optionId: "reject-a", name: "本次拒绝此操作", kind: "reject_once" },
    { optionId: "reject-b", name: "始终拒绝此操作", kind: "reject_always" },
  ],
};
for (const [platform, Card] of [
  ["web", WebCard],
  ["desktop", DesktopCard],
] as const) {
  it(`${platform}：原样呈现所有 ACP 选项，同类选择保留精确 optionId 和独立幂等键`, async () => {
    const onResolve = vi.fn().mockRejectedValue(new Error("offline"));
    const screen = await render(<Card request={request} interactive onResolve={onResolve} />);
    for (const option of request.acpOptions!)
      await expect
        .element(screen.getByRole("button", { name: option.name, exact: true }))
        .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "允许", exact: true }))
      .not.toBeInTheDocument();
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
    const first = screen.getByRole("button", { name: "仅读取这个文件", exact: true });
    await first.click();
    await expect.element(first).toBeEnabled();
    expect(onResolve).toHaveBeenLastCalledWith(
      request,
      { decision: "allow", optionId: "once-a" },
      expect.any(String),
    );
    const key = onResolve.mock.calls[0]![2];
    await first.click();
    await expect.element(first).toBeEnabled();
    expect(onResolve.mock.calls[1]![2]).toBe(key);
    await screen.getByRole("button", { name: "另一个单次选择", exact: true }).click();
    await expect.element(first).toBeEnabled();
    expect(onResolve.mock.calls[2]![1]).toEqual({ decision: "allow", optionId: "once-b" });
    expect(onResolve.mock.calls[2]![2]).not.toBe(key);
    await screen.getByRole("button", { name: "始终允许此操作", exact: true }).click();
    await expect.element(first).toBeEnabled();
    expect(onResolve.mock.calls[3]![1]).toEqual({ decision: "allow", optionId: "always-a" });
    await screen.getByRole("button", { name: "始终拒绝此操作", exact: true }).click();
    await expect.element(first).toBeEnabled();
    expect(onResolve.mock.calls[4]![1]).toEqual({ decision: "deny", optionId: "reject-b" });
    await screen.unmount();
  });
  it(`${platform}：队列、过期与提交中的请求不允许再次授权`, async () => {
    let resolve!: () => void;
    const onResolve = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const screen = await render(
      <Card request={request} interactive={false} onResolve={onResolve} />,
    );
    const button = screen.getByRole("button", { name: "始终允许此操作", exact: true });
    await expect.element(button).toBeDisabled();
    await screen.rerender(<Card request={request} interactive onResolve={onResolve} />);
    await button.click();
    await expect.element(button).toBeDisabled();
    expect(onResolve).toHaveBeenCalledTimes(1);
    await screen.rerender(
      <Card request={{ ...request, status: "expired" }} interactive onResolve={onResolve} />,
    );
    await expect.element(button).not.toBeInTheDocument();
    resolve();
    await screen.unmount();
  });
}
