import { AcpActivity } from "@codexly/ui/core/acp-activity";
import type { AcpSessionState } from "@codexly/protocol";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import "../../src/shared/styles/globals.css";

it("回执不展示发送提示，后台工作由上下文区域展示", async () => {
  const session: AcpSessionState = {
    availableCommands: [], configOptions: [], foreground: "running",
    promptReceipt: { turnId: "turn", messageId: "agent-message" },
    background: [{ kind: "terminal", id: "tests", label: "pnpm test", cancellable: true }],
  };
  const screen = await render(<AcpActivity language="zh-CN" session={session} turnId="turn" />);
  await expect.element(screen.getByText("消息已发送")).not.toBeInTheDocument();
  await expect.element(screen.getByText("pnpm test")).not.toBeInTheDocument();
  await screen.rerender(<AcpActivity language="zh-CN" session={{ ...session, foreground: "requires_action" }} turnId="turn" />);
  await expect.element(screen.getByText("等待操作")).toBeVisible();
});

it("任务失败后不继续显示旧的 ACP 前台运行状态", async () => {
  const session: AcpSessionState = {
    availableCommands: [], configOptions: [], foreground: "running",
  };
  const screen = await render(<AcpActivity language="zh-CN" session={session} />);
  await expect.element(screen.getByText("任务正在运行")).toBeVisible();
  await screen.rerender(<AcpActivity language="zh-CN" session={session} taskFailed />);
  await expect.element(screen.getByText("任务正在运行")).not.toBeInTheDocument();
});

it.each([
  ["light", 260], ["light", 360], ["dark", 260], ["dark", 360],
] as const)("后台任务在 %s 主题、%spx 侧栏下保持紧凑且支持停止重试", async (theme, width) => {
  const { AcpBackgroundSection } = await import("@codexly/ui/core/acp-activity");
  const { InspectorSection } = await import("@codexly/ui/core/inspector-section");
  const { TooltipProvider } = await import("@codexly/ui/core/tooltip");
  const { ListTodo } = await import("lucide-react");
  const { page, userEvent } = await import("vitest/browser");
  const { vi } = await import("vitest");
  const longLabel = "pnpm --filter @codexly/server test --watch --reporter=verbose";
  const session: AcpSessionState = {
    configOptions: [], availableCommands: [], foreground: "running",
    background: [
      { kind: "terminal", id: "tests", label: longLabel, cancellable: true },
      { kind: "tool_call", id: "watch", label: "持续检查工作区文件", cancellable: true, paused: true },
      { kind: "subagent", id: "child", label: "检查桌面与 Web 的类型一致性", cancellable: false },
    ],
  };
  const source = {
    subscribe: () => () => undefined,
    getState: () => ({ projectId: "p", taskId: "t", snapshotMetadata: { acpSession: session } }),
  };
  const accepted = Promise.withResolvers<unknown>();
  const cancel = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockImplementationOnce(() => accepted.promise);
  document.documentElement.dataset.theme = theme;
  const screen = await render(
    <TooltipProvider>
      <div style={{ width }} className="space-y-5 bg-panel p-2.5">
        <InspectorSection title="计划" icon={<ListTodo className="size-3.5" />}>
          <p className="px-2 text-caption text-muted-foreground">检查共享组件与双端行为</p>
        </InspectorSection>
        <AcpBackgroundSection source={source} projectId="p" taskId="t" language="zh-CN" onCancel={cancel} />
      </div>
    </TooltipProvider>,
  );
  try {
    const section = screen.getByRole("region", { name: "后台任务" });
    await expect.element(section).toBeVisible();
    await expect.element(screen.getByText("终端", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("工具", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("子 Agent", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("已暂停", { exact: true })).toBeVisible();
    const row = screen.getByText(longLabel, { exact: true }).element().closest("li");
    if (!row) throw new Error("后台行缺失");
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
    const stop = screen.getByRole("button", { name: `停止 ${longLabel}`, exact: true });
    await expect.element(stop).toBeVisible();
    expect(stop.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(32);
    expect(section.element().querySelector("h3")?.className)
      .toBe(screen.getByRole("region", { name: "计划" }).element().querySelector("h3")?.className);
    await page.screenshot({ path: `../../test-results/acp-background-${theme}-${width}.png` });
    await stop.click();
    await expect.element(screen.getByText("停止失败，请重试")).toBeVisible();
    const retry = screen.getByRole("button", { name: `重试停止 ${longLabel}`, exact: true });
    retry.element().focus();
    await expect.element(retry).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("正在请求停止")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: `停止 ${longLabel}`, exact: true })).toBeDisabled();
    accepted.resolve({});
    await expect.element(screen.getByText("已请求停止", { exact: true })).toBeVisible();
    expect(cancel).toHaveBeenCalledTimes(2);
  } finally {
    accepted.resolve({});
    await screen.unmount();
    delete document.documentElement.dataset.theme;
  }
});
