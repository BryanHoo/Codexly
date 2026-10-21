import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { projectRemoveMutationOptions } from "../../projects/project-query-options.js";
import { createSavedPromptStore } from "@codexly/frontend-core/saved-prompts";
import { render } from "vitest-browser-react";
import { SavedPromptsSettings } from "@codexly/ui/core/saved-prompts-settings";
import { savedPromptsStore } from "@codexly/ui/core/saved-prompts-store";
import { SAVED_PROMPTS_STORAGE_KEY } from "@codexly/frontend-core/saved-prompts";
import "../../../shared/styles/globals.css";

beforeEach(() => {
  localStorage.removeItem(SAVED_PROMPTS_STORAGE_KEY);
  savedPromptsStore.refresh();
});

it("通过管理页新增、查询、编辑并确认删除提示词", async () => {
  const screen = await render(<SavedPromptsSettings language="zh-CN" />);
  await screen.getByRole("button", { name: "新建提示词", exact: true }).click();
  await screen.getByRole("textbox", { name: "名称", exact: true }).fill("代码检查");
  await screen.getByRole("textbox", { name: "快捷词", exact: true }).fill("check");
  await screen.getByRole("textbox", { name: "提示词内容", exact: true }).fill("检查代码。\n保留现有行为。");
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  await expect.element(screen.getByText("/check", { exact: true })).toBeVisible();
  expect(JSON.parse(localStorage.getItem(SAVED_PROMPTS_STORAGE_KEY)!).prompts[0].content).toBe("检查代码。\n保留现有行为。");
  await screen.getByRole("searchbox", { name: "搜索常用提示词" }).fill("不存在");
  await expect.element(screen.getByText("未找到匹配的提示词")).toBeVisible();
  await screen.getByRole("searchbox", { name: "搜索常用提示词" }).fill("CHECK");
  await screen.getByRole("button", { name: "编辑代码检查" }).click();
  await screen.getByRole("textbox", { name: "名称", exact: true }).fill("检查修改");
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  await screen.getByRole("button", { name: "删除检查修改" }).click();
  expect(savedPromptsStore.getSnapshot()).toHaveLength(1);
  await screen.getByRole("button", { name: "确认删除", exact: true }).click();
  expect(savedPromptsStore.getSnapshot()).toHaveLength(0);
});

it("拒绝重复快捷词并在关闭未保存编辑时确认", async () => {
  savedPromptsStore.save({ name: "已有", shortcut: "check", content: "内容" });
  const screen = await render(<SavedPromptsSettings language="zh-CN" />);
  await screen.getByRole("button", { name: "新建提示词", exact: true }).click();
  await screen.getByRole("textbox", { name: "名称", exact: true }).fill("新建");
  await screen.getByRole("textbox", { name: "快捷词", exact: true }).fill("CHECK");
  await screen.getByRole("textbox", { name: "提示词内容", exact: true }).fill("未保存内容");
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("此快捷词已被使用");
  await screen.getByRole("button", { name: "取消", exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "放弃未保存的修改？" })).toBeVisible();
  await screen.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect.element(screen.getByRole("textbox", { name: "提示词内容", exact: true })).toHaveValue("未保存内容");
});


it("按项目保存、筛选并调整提示词范围，默认仍为全局", async () => {
  await page.viewport(390, 844);
  savedPromptsStore.save({ name: "全局检查", shortcut: "check", content: "全局正文" });
  const projects = [{ id: "a", name: "项目 A" }, { id: "b", name: "项目 B" }];
  const screen = await render(<SavedPromptsSettings language="zh-CN" projects={projects} />);
  await screen.getByRole("button", { name: "新建提示词", exact: true }).click();
  await expect.element(screen.getByRole("combobox", { name: "可用范围" })).toHaveTextContent("全局");
  await screen.getByRole("textbox", { name: "名称", exact: true }).fill("项目检查");
  await screen.getByRole("textbox", { name: "快捷词", exact: true }).fill("check");
  await screen.getByRole("textbox", { name: "提示词内容", exact: true }).fill("项目正文");
  await screen.getByRole("combobox", { name: "可用范围" }).click();
  await screen.getByRole("option", { name: "项目 A", exact: true }).click();
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  expect(savedPromptsStore.getSnapshot().find((prompt) => prompt.name === "项目检查")?.projectId).toBe("a");
  await screen.getByRole("combobox", { name: "按项目筛选" }).click();
  await screen.getByRole("option", { name: "项目 A", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "编辑项目检查" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "编辑全局检查" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "编辑项目检查" }).click();
  await screen.getByRole("combobox", { name: "可用范围" }).click();
  await screen.getByRole("option", { name: "项目 B", exact: true }).click();
  await screen.getByRole("button", { name: "取消", exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "放弃未保存的修改？" })).toBeVisible();
  await screen.getByRole("button", { name: "继续编辑", exact: true }).click();
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "编辑项目检查" })).not.toBeInTheDocument();
  await screen.getByRole("combobox", { name: "按项目筛选" }).click();
  await screen.getByRole("option", { name: "全局", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "编辑全局检查" })).toBeVisible();
  await screen.getByRole("combobox", { name: "按项目筛选" }).click();
  await screen.getByRole("option", { name: "全部范围", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "编辑项目检查" })).toBeVisible();
  await screen.getByRole("button", { name: "编辑项目检查" }).click();
  await expect.element(screen.getByRole("combobox", { name: "可用范围" })).toHaveTextContent("项目 B");
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});


it("桌面端删除项目失败时保留提示词，成功后持久化清理该项目的全部提示词", async () => {
  const global = savedPromptsStore.save({ name: "全局", shortcut: "check", content: "正文" });
  savedPromptsStore.save({ name: "项目", shortcut: "check", content: "正文", projectId: "a" });
  savedPromptsStore.save({ name: "项目二", shortcut: "other", content: "正文", projectId: "a" });
  const other = savedPromptsStore.save({ name: "其他项目", shortcut: "check", content: "正文", projectId: "b" });
  const removeProject = vi.fn<(_: string) => Promise<{ projectId: string; status: "removed" }>>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ projectId: "a", status: "removed" });
  const mutate = projectRemoveMutationOptions({ removeProject }).mutationFn!;
  await expect(mutate("a", {} as never)).rejects.toThrow("offline");
  expect(savedPromptsStore.getSnapshot()).toHaveLength(4);
  await mutate("a", {} as never);
  expect(createSavedPromptStore(localStorage).getSnapshot()).toEqual([global, other]);
});

it("项目列表失效时保留原范围并阻止误存为全局", async () => {
  savedPromptsStore.save({ name: "失效项目", shortcut: "check", content: "正文", projectId: "missing" });
  const screen = await render(<SavedPromptsSettings language="zh-CN" projectsUnavailable />);
  await screen.getByRole("button", { name: "编辑失效项目" }).click();
  await expect.element(screen.getByRole("combobox", { name: "可用范围" })).toHaveTextContent("项目不可用");
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("请选择可用的项目");
  expect(savedPromptsStore.getSnapshot()[0]?.projectId).toBe("missing");
  await screen.getByRole("combobox", { name: "可用范围" }).click();
  await screen.getByRole("option", { name: "全局", exact: true }).click();
  await screen.getByRole("button", { name: "保存", exact: true }).click();
  expect(savedPromptsStore.getSnapshot()[0]?.projectId).toBeUndefined();
});
