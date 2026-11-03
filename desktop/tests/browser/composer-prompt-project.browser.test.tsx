import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import {
  ComposerSubmitActions,
  ComposerPromptProjectsContext,
} from "@codexly/ui/core/composer-submit-actions";
import { savedPromptsStore } from "@codexly/ui/core/saved-prompts-store";
import { SAVED_PROMPTS_STORAGE_KEY } from "@codexly/frontend-core/saved-prompts";
import "../../src/shared/styles/globals.css";

beforeEach(() => {
  localStorage.removeItem(SAVED_PROMPTS_STORAGE_KEY);
  savedPromptsStore.refresh();
});

test.each([false, true])("完整范围列表允许项目与聊天改选其他项目，聊天：%s", async (chat) => {
  const projects = [
    { id: "a", name: "项目甲" },
    { id: "b", name: "项目乙" },
  ];
  const screen = await render(
    <ComposerPromptProjectsContext value={projects}>
      <ComposerSubmitActions
        language="zh-CN"
        content="保持原始内容"
        project={chat ? undefined : projects[0]}
        disabled={false}
        todoDisabled={false}
        todoLabel="保存为待办"
      >
        <button type="button">发送</button>
      </ComposerSubmitActions>
    </ComposerPromptProjectsContext>,
  );
  await screen.getByRole("button", { name: "更多发送操作" }).click();
  await screen.getByRole("menuitem", { name: "保存为常用提示词" }).click();
  const scope = screen.getByRole("combobox", { name: "可用范围" });
  await expect.element(scope).toHaveTextContent(chat ? "全局" : "项目甲");
  await scope.click();
  await expect.element(screen.getByRole("option", { name: "全局", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("option", { name: "项目甲", exact: true })).toBeVisible();
  await screen.getByRole("option", { name: "项目乙", exact: true }).click();
  await screen.getByRole("textbox", { name: "标题", exact: true }).fill("跨项目提示词");
  await expect
    .element(screen.getByRole("textbox", { name: "提示词内容", exact: true }))
    .toHaveValue("保持原始内容");
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  expect(savedPromptsStore.getSnapshot()[0]).toMatchObject({
    projectId: "b",
    content: "保持原始内容",
  });
});

test.each([false, true])(
  "名称更新不影响项目绑定或未保存内容，切换项目：%s",
  async (switchProject) => {
    const view = (id: string, name: string) => (
      <ComposerSubmitActions
        language="zh-CN"
        content="原始正文"
        project={{ id, name }}
        disabled={false}
        todoDisabled={false}
        todoLabel="保存为待办"
      >
        <button type="button">发送</button>
      </ComposerSubmitActions>
    );
    const screen = await render(view("project-a", switchProject ? "原项目" : "project-a"));
    await screen.getByRole("button", { name: "更多发送操作" }).click();
    await screen.getByRole("menuitem", { name: "保存为常用提示词" }).click();
    await screen.getByRole("textbox", { name: "标题", exact: true }).fill("我的提示词");
    await screen.getByRole("textbox", { name: "提示词内容", exact: true }).fill("已编辑正文");
    await screen.rerender(view(switchProject ? "project-b" : "project-a", "已加载项目名称"));
    await expect
      .element(screen.getByRole("combobox", { name: "可用范围" }))
      .toHaveTextContent(switchProject ? "原项目" : "已加载项目名称");
    await expect
      .element(screen.getByRole("textbox", { name: "提示词内容", exact: true }))
      .toHaveValue("已编辑正文");
    await screen.getByRole("button", { name: "保存", exact: true }).click();
    expect(savedPromptsStore.getSnapshot()[0]).toMatchObject({
      projectId: "project-a",
      name: "我的提示词",
      content: "已编辑正文",
    });
  },
);
