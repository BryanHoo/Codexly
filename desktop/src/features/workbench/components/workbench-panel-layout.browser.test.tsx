import { useState } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { conversationDisplayPreferences } from "../../settings/conversation-display-preferences.js";
import { useWorkbenchPanelLayout } from "./workbench-panel-layout.js";

it("右栏默认收起，手动开关和会话切换遵循默认展开偏好", async () => {
  await page.viewport(1440, 900);
  function Harness() {
    const [task, setTask] = useState("a");
    const { inspectorOpen, setInspectorOpen } = useWorkbenchPanelLayout({ scopeKey: task });
    return <>
      <output>{inspectorOpen ? "展开" : "收起"}</output>
      <button onClick={() => setInspectorOpen((open) => !open)}>切换右栏</button>
      <button onClick={() => setTask("b")}>切换任务</button>
    </>;
  }
  const screen = await render(<Harness />);
  try {
    await expect.element(screen.getByText("收起", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "切换右栏" }).click();
    await expect.element(screen.getByText("展开", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "切换任务" }).click();
    await expect.element(screen.getByText("收起", { exact: true })).toBeVisible();
    conversationDisplayPreferences.set("inspectorInitiallyOpen", true);
    await expect.element(screen.getByText("展开", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "切换右栏" }).click();
    await expect.element(screen.getByText("收起", { exact: true })).toBeVisible();
  } finally {
    conversationDisplayPreferences.set("inspectorInitiallyOpen", false);
  }
});
