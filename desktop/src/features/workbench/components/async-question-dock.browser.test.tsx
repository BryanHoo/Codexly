import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { AsyncQuestionProvider } from "./async-question-session.js";
import { AsyncQuestionDock } from "./async-question-dock.js";
import { questionItem, questionTask } from "./async-question-test-fixtures.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

test("switches groups and preserves answers while collapsed, then removes accepted groups", async () => {
  const submit = vi.fn(async () => true);
  const store = questionTask([questionItem("first", "第一组"), questionItem("second", "第二组")]);
  const screen = await render(<TooltipProvider>
    <AsyncQuestionProvider enabled submit={submit}><AsyncQuestionDock taskStore={store} /></AsyncQuestionProvider>
  </TooltipProvider>);
  await expect.element(screen.getByText("第一组", { exact: true })).toBeVisible();
  await screen.getByRole("textbox").fill("保留草稿");
  await screen.getByRole("button", { name: /下一组问题|Next questions/u }).click();
  await expect.element(screen.getByText("第二组", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: /上一组问题|Previous questions/u }).click();
  await expect.element(screen.getByRole("textbox")).toHaveValue("保留草稿");
  await screen.getByRole("button", { name: /收起问题|Collapse questions/u }).click();
  await expect.element(screen.getByRole("textbox", { includeHidden: true })).not.toBeVisible();
  await screen.getByRole("button", { name: /展开问题|Expand questions/u }).click();
  await expect.element(screen.getByRole("textbox")).toHaveValue("保留草稿");
  await screen.getByRole("button", { name: /发送回答|Send answers/u }).click();
  await expect.element(screen.getByText("第二组", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: /发送回答|Send answers/u }).click();
  await expect.element(screen.getByRole("region", { name: /待回答问题|Pending questions/u })).not.toBeInTheDocument();
  expect(submit).toHaveBeenNthCalledWith(1, "第一组\n保留草稿");
  expect(submit).toHaveBeenNthCalledWith(2, "第二组\n当前文件");
});

test("dismisses unanswered groups without submitting and keeps remaining questions visible", async () => {
  const submit = vi.fn(async () => true);
  const store = questionTask([
    { ...questionItem("first", "第一组"), questions: [{ title: "第一组", options: null }] },
    questionItem("second", "第二组"),
  ]);
  const screen = await render(<TooltipProvider>
    <AsyncQuestionProvider enabled={false} submit={submit}><AsyncQuestionDock taskStore={store} /></AsyncQuestionProvider>
  </TooltipProvider>);
  await expect.element(screen.getByRole("textbox")).toHaveValue("");
  await screen.getByRole("button", { name: /关闭问题|Dismiss questions/u }).click();
  await expect.element(screen.getByText("第一组", { exact: true })).not.toBeInTheDocument();
  await expect.element(screen.getByText("第二组", { exact: true })).toBeVisible();
  await screen.rerender(<TooltipProvider>
    <AsyncQuestionProvider enabled submit={submit}><AsyncQuestionDock taskStore={store} /></AsyncQuestionProvider>
  </TooltipProvider>);
  await expect.element(screen.getByText("第一组", { exact: true })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: /关闭问题|Dismiss questions/u }).click();
  await expect.element(screen.getByRole("region", { name: /待回答问题|Pending questions/u })).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
  const next = questionTask([questionItem("first", "第一组"), questionItem("second", "第二组"), questionItem("third", "第三组")]).getState();
  store.setState({ itemKeysByTurnId: next.itemKeysByTurnId, itemStoresByKey: next.itemStoresByKey });
  await expect.element(screen.getByText("第三组", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("第一组", { exact: true })).not.toBeInTheDocument();
});

test.each([{ width: 1280, height: 720 }, { width: 1920, height: 1080 }])(
  "stays above the composer with matching width at $width x $height", async ({ width, height }) => {
  await page.viewport(width, height);
  const store = questionTask([{ ...questionItem("first"), questions: Array.from({ length: 16 }, (_, index) => ({
    title: `确认事项 ${index + 1}`, options: ["当前文件", "整个项目"],
  })) }]);
  const screen = await render(<TooltipProvider>
    <div data-testid="center" style={{ display: "flex", flexDirection: "column", width: width - 560, height: height - 100 }}>
      <div data-testid="timeline" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <div style={{ height: 2400 }}>执行记录</div>
      </div>
      <AsyncQuestionProvider enabled submit={async () => true}><AsyncQuestionDock taskStore={store} /></AsyncQuestionProvider>
      <section className="shrink-0 px-1 sm:px-5">
        <textarea aria-label="composer" className="mx-auto block w-full max-w-content" style={{ height: 90 }} defaultValue="未发送草稿" />
      </section>
    </div>
  </TooltipProvider>);
  const region = screen.getByRole("region", { name: /待回答问题|Pending questions/u }).element();
  await expect.element(screen.getByText("确认事项 1", { exact: true })).toBeVisible();
  const before = region.getBoundingClientRect();
  const timeline = screen.getByTestId("timeline").element();
  const composer = screen.getByRole("textbox", { name: "composer", exact: true }).element().getBoundingClientRect();
  expect(before.width).toBe(composer.width);
  expect(before.left).toBe(composer.left);
  expect(before.top).toBeGreaterThanOrEqual(timeline.getBoundingClientRect().bottom);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  timeline.scrollTop = 1200;
  expect(region.getBoundingClientRect().top).toBe(before.top);
  expect(before.height).toBeLessThanOrEqual(Math.min(height * 0.32, 320) + 60);
  expect(screen.getByRole("textbox", { name: "composer", exact: true }).element().getBoundingClientRect().top).toBeGreaterThanOrEqual(before.bottom);
  await page.screenshot({ path: `../../../../test-results/question-dock-${width}.png` });
});

test("keeps dismissed questions hidden after leaving and reopening the task", async () => {
  const scope = JSON.stringify(["project", crypto.randomUUID()]);
  const submit = vi.fn(async () => true);
  const view = (taskScope: string) => <TooltipProvider>
    <AsyncQuestionProvider enabled scope={taskScope} submit={submit}>
      <AsyncQuestionDock taskStore={questionTask([questionItem("same-id", "重新打开的问题")])} />
    </AsyncQuestionProvider>
  </TooltipProvider>;
  const first = await render(view(scope));
  await first.getByRole("button", { name: /关闭问题|Dismiss questions/u }).click();
  await first.unmount();
  const other = await render(view(`${scope}-other`));
  await expect.element(other.getByText("重新打开的问题", { exact: true })).toBeVisible();
  await other.unmount();
  const reopened = await render(view(scope));
  await expect.element(reopened.getByRole("region", { name: /待回答问题|Pending questions/u })).not.toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});

test("keeps a question dismissed when an in-flight answer finishes", async () => {
  let finish!: (accepted: boolean) => void;
  const submit = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
  const screen = await render(<TooltipProvider>
    <AsyncQuestionProvider enabled submit={submit}>
      <AsyncQuestionDock taskStore={questionTask([questionItem("sending")])} />
    </AsyncQuestionProvider>
  </TooltipProvider>);
  await screen.getByRole("button", { name: /发送回答|Send answers/u }).click();
  await screen.getByRole("button", { name: /关闭问题|Dismiss questions/u }).click();
  finish(false);
  await expect.element(screen.getByRole("region", { name: /待回答问题|Pending questions/u })).not.toBeInTheDocument();
  expect(submit).toHaveBeenCalledTimes(1);
});
