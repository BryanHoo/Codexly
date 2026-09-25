import { useState } from "react";
import { expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { useWorkbenchPanelLayout } from "./workbench-panel-layout.js";

it("聊天默认收起右栏，手动展开后保持，切换聊天任务重新默认收起", async () => {
  await page.viewport(1440, 900);
  function Harness() {
    const [task, setTask] = useState("a");
    const [temporary, setTemporary] = useState(true);
    const { inspectorOpen, setInspectorOpen } = useWorkbenchPanelLayout({ temporary, scopeKey: task });
    return <>
      <output>{inspectorOpen ? "展开" : "收起"}</output>
      <button onClick={() => setInspectorOpen((open) => !open)}>切换右栏</button>
      <button onClick={() => setTask("b")}>切换聊天</button>
      <button onClick={() => setTemporary(false)}>进入项目</button>
    </>;
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByText("收起", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "切换右栏" }).click();
  await expect.element(screen.getByText("展开", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "切换聊天" }).click();
  await expect.element(screen.getByText("收起", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "进入项目" }).click();
  await expect.element(screen.getByText("展开", { exact: true })).toBeVisible();
});
