import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { TimelineItemContent } from "./task-timeline-items.js";
import { AsyncQuestions } from "./async-questions.js";
import { AsyncQuestionProvider } from "./async-question-session.js";
import type { AgentItem } from "@/protocol/index.js";
import { useState } from "react";
import { page } from "vitest/browser";
import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

const item = { id: "question-a", type: "message", role: "assistant", text: "fallback text",
  questions: [{ title: "选择范围", options: ["当前文件", "整个项目"] }] } satisfies AgentItem;

test("does not allow answering while disconnected", async () => {
  const submit = vi.fn(async () => true);
  const screen = await render(<AsyncQuestionProvider enabled={false} submit={submit}>
    <AsyncQuestions item={item} />
  </AsyncQuestionProvider>);
  await expect.element(screen.getByRole("radio", { name: "当前文件", exact: true })).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});

test("keeps rejected answers for retry and submits ordinary text only once", async () => {
  const submit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const screen = await render(<AsyncQuestionProvider enabled submit={submit}>
    <AsyncQuestions item={item} />
  </AsyncQuestionProvider>);
  await expect.element(screen.getByRole("radio", { name: "当前文件", exact: true })).toBeChecked();
  expect(submit).not.toHaveBeenCalled();
  await screen.getByRole("textbox").fill("仅修改测试");
  await screen.getByRole("button").click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(screen.getByRole("textbox")).toHaveValue("仅修改测试");
  await screen.getByRole("button").click();
  await expect.element(screen.getByRole("button")).toBeDisabled();
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit).toHaveBeenLastCalledWith("选择范围\n仅修改测试");
});

test("retains drafts after virtual unmount and requires every free-text answer", async () => {
  const submit = vi.fn(async () => true);
  function Harness() {
    const [visible, setVisible] = useState(true);
    return <AsyncQuestionProvider enabled submit={submit}>
      <button onClick={() => setVisible((current) => !current)}>toggle</button>
      {visible ? <AsyncQuestions item={{ ...item, questions: [
        { title: "选择范围", options: ["当前文件", "整个项目"] },
        { title: "补充要求", options: null },
      ] }} /> : null}
    </AsyncQuestionProvider>;
  }
  const screen = await render(<Harness />);
  const send = screen.getByRole("button", { name: /发送回答|Send answers/u });
  await expect.element(send).toBeDisabled();
  await screen.getByRole("radio", { name: "整个项目", exact: true }).click();
  await screen.getByRole("textbox", { name: /补充要求/u }).fill("保留测试");
  await screen.getByRole("button", { name: "toggle" }).click();
  await screen.getByRole("button", { name: "toggle" }).click();
  await expect.element(screen.getByRole("radio", { name: "整个项目", exact: true })).toBeChecked();
  await expect.element(screen.getByRole("textbox", { name: /补充要求/u })).toHaveValue("保留测试");
  await send.click();
  expect(submit).toHaveBeenCalledExactlyOnceWith("选择范围\n整个项目\n\n补充要求\n保留测试");
});

test("keeps long question content within a desktop timeline column", async () => {
  const screen = await render(<div style={{ width: 480, padding: 16 }}>
    <AsyncQuestionProvider enabled submit={async () => true}>
      <AsyncQuestions item={{ ...item, questions: [
        { title: "选择接入范围", options: ["仅当前项目", "所有桌面端项目"] },
        { title: "额外约束", options: null },
        { title: "long_identifier_".repeat(24), options: null },
      ] }} />
    </AsyncQuestionProvider>
  </div>);
  await expect.element(screen.getByText("选择接入范围", { exact: true })).toBeVisible();
  const form = document.querySelector("form");
  expect(form).not.toBeNull();
  expect(form!.scrollWidth).toBeLessThanOrEqual(form!.clientWidth);
  await page.screenshot({ path: "../../../../test-results/codeagent-153-questions.png" });
});

test("keeps timeline questions read-only without duplicate form controls", async () => {
  const screen = await render(<TimelineItemContent
    isLastTurnItem={false}
    item={{ id: "question-a", type: "message", role: "assistant", text: "fallback text",
      questions: [{ title: "选择范围", options: ["当前文件", "整个项目"] }] }}
    onOpenFileDiff={() => undefined}
    onOpenSourceFile={() => undefined}
    projectId="project-a"
    taskId="task-a"
    turnStatus="running"
  />);
  expect(document.querySelectorAll("input, textarea")).toHaveLength(0);
  await expect.element(screen.getByText("选择范围")).toBeVisible();
  await expect.element(screen.getByText("fallback text")).not.toBeInTheDocument();
});
