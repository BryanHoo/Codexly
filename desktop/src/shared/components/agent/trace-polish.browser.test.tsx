import { useState } from "react";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Tool, ToolBody, ToolHeader } from "./tool.js";
import "../../styles/globals.css";

it("使用状态图标并保留可访问状态，标题不重复显示完成前缀", async () => {
  const screen = await render(
    <Tool>
      <ToolHeader state="output-available" title="检查工作区" />
    </Tool>,
  );
  const trigger = screen.getByRole("button");
  expect((trigger.element() as HTMLElement).innerText).toBe("检查工作区");
  expect(trigger.element().querySelector(".lucide-circle-check")).not.toBeNull();
  expect(trigger.element().getAttribute("aria-label")).toMatch(/检查工作区/);
});

it("收起详情保留退出过渡，结束后卸载输出", async () => {
  const screen = await render(
    <Tool defaultOpen>
      <ToolHeader state="output-available" title="命令输出" />
      <ToolBody>
        <div data-heavy-output="" style={{ height: 120 }}>
          详细输出
        </div>
      </ToolBody>
    </Tool>,
  );
  await screen.getByRole("button").click();
  const content = screen.container.querySelector<HTMLElement>(
    '[data-slot="trace-collapsible-content"]',
  );
  expect(content).not.toBeNull();
  expect(
    content
      ?.getAnimations()
      .some((animation) => (animation as CSSAnimation).animationName === "agent-trace-collapse"),
  ).toBe(true);
  await expect.poll(() => screen.container.querySelector("[data-heavy-output]")).toBeNull();
});

it("连续执行步骤保持紧凑行高和一致的图标基线", async () => {
  const screen = await render(
    <Tool>
      <ToolHeader state="input-available" title="一个持续运行的命令" />
    </Tool>,
  );
  const line = screen.container.querySelector<HTMLElement>('[data-slot="trace-line"]')!;
  expect(line.getBoundingClientRect().height).toBeLessThanOrEqual(30);
  expect(line.querySelector(".lucide-loader-circle")).not.toBeNull();
  expect(getComputedStyle(line.querySelector('[data-slot="trace-title"]')!).animationName).toBe(
    "agent-shimmer",
  );
});

it("思考过程随流式状态展开和收起，用户手动选择优先", async () => {
  function Harness() {
    const [running, setRunning] = useState(true);
    return (
      <>
        <button onClick={() => setRunning(false)}>结束思考</button>
        <Tool {...{ isStreaming: running }}>
          <ToolHeader title="思考摘要" state={running ? "input-available" : "output-available"} />
          <ToolBody>
            <div>完整思考摘要</div>
          </ToolBody>
        </Tool>
      </>
    );
  }
  const screen = await render(<Harness />);
  await expect.element(screen.getByText("完整思考摘要", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "结束思考", exact: true }).click();
  await expect.poll(() => screen.getByText("完整思考摘要", { exact: true }).query()).toBeNull();
  await screen.getByRole("button", { name: /思考摘要/ }).click();
  await expect.element(screen.getByText("完整思考摘要", { exact: true })).toBeVisible();
});
