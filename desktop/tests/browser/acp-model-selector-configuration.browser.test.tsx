import { AcpComposerLeading } from "@codexly/ui/core/acp-model-selector";
import type { AcpConfigOption } from "@codexly/protocol";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import "../../src/shared/styles/globals.css";

it("配置直接使用公共下拉，隐藏说明并随界面语言切换，原始值保持不变", async () => {
  const change = vi.fn();
  const controls: AcpConfigOption[] = [
    {
      id: "mode",
      name: "Mode",
      type: "select",
      currentValue: "agent-full-access",
      options: [
        { value: "manual", name: "Manual" },
        { value: "agent", name: "Auto review" },
        { value: "agent-full-access", name: "Full access" },
      ],
      description: "Approval and sandboxing preset for the session",
    },
    {
      id: "collaboration_mode",
      name: "Collaboration mode",
      type: "select",
      currentValue: "default",
      options: [
        { value: "default", name: "Default" },
        { value: "plan", name: "Plan" },
      ],
      description: "How Codex collaborates for subsequent turns",
    },
    {
      id: "web-search",
      name: "Web search",
      type: "boolean",
      currentValue: false,
      description: "1.5x speed, increased usage",
    },
  ];
  const screen = await render(
    <AcpComposerLeading
      options={controls}
      disabled={false}
      error={null}
      label="输入配置"
      language="zh-CN"
      onChange={change}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "权限模式", exact: true }))
    .toHaveTextContent("完全访问");
  expect(document.querySelector("select")).toBeNull();
  expect(document.body.textContent).not.toContain("Approval and sandboxing");
  await screen.getByRole("button", { name: "权限模式", exact: true }).click();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "每次询问", exact: true }))
    .toBeVisible();
  await screen.getByRole("menuitemradio", { name: "自动审核", exact: true }).click();
  expect(change).toHaveBeenLastCalledWith("mode", "agent");
  await screen.getByRole("button", { name: "联网搜索", exact: true }).click();
  await screen.getByRole("menuitemradio", { name: "开启", exact: true }).click();
  expect(change).toHaveBeenLastCalledWith("web-search", true);
  await screen.getByRole("button", { name: "协作模式", exact: true }).click();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "计划", exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await screen.rerender(
    <AcpComposerLeading
      options={controls}
      disabled={false}
      error={null}
      label="Configuration"
      language="en"
      onChange={change}
    />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Mode", exact: true }))
    .toHaveTextContent("Full access");
  await screen.getByRole("button", { name: "Collaboration mode", exact: true }).click();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "Plan", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("menuitemradio", { name: "计划", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
});
