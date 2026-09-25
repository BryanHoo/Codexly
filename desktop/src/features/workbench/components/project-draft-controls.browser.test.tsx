import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import "../../../shared/styles/globals.css";
import "../../../shared/styles/workbench.css";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import type { ProjectDraftRecord } from "../project-draft-store.js";
import { ComposerDraftSaveButton, ProjectDraftList } from "./project-draft-controls.js";

const drafts: readonly ProjectDraftRecord[] = [
  {
    createdAt: 1_000,
    draft: {
      attachments: [],
      content: [{ text: "修复登录状态恢复", type: "text" }],
    },
    id: "draft-a",
    updatedAt: 2_000,
    workingDraft: {
      attachments: [],
      content: [{ text: "尚未保存的修改", type: "text" }],
    },
  },
  {
    createdAt: 500,
    draft: {
      attachments: [],
      content: [{ text: "补充性能测试", type: "text" }],
    },
    id: "draft-b",
    updatedAt: 1_500,
  },
];

describe("project draft controls", () => {
  it("opens the project draft list and keeps delete separate from restore", async () => {
    await i18n.changeLanguage("zh-CN");
    const onDelete = vi.fn();
    const onRestore = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ProjectDraftList
            composerHasInput={false}
            drafts={drafts}
            onDelete={onDelete}
            onRestore={onRestore}
            projectName="CodeAgent"
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "待办 2" }).click();
    await expect.element(screen.getByText("CodeAgent的待办")).toBeVisible();
    await expect.element(screen.getByText("修复登录状态恢复")).toBeVisible();
    await expect.element(screen.getByText("有未保存修改")).toBeVisible();
    expect(screen.getByRole("button", { name: "待办 2" }).element().querySelector("svg")).toBeNull();
    const restoreButton = screen.getByRole("button", {
      name: "修复登录状态恢复",
      exact: true,
    });
    await restoreButton.hover();
    expect(getComputedStyle(restoreButton.element().closest("[role='listitem']")!)).toHaveProperty(
      "backgroundColor",
      "rgba(0, 0, 0, 0)",
    );
    const draftItem = restoreButton.element().closest<HTMLElement>("[role='listitem']");
    expect(draftItem).not.toBeNull();
    expect(draftItem!.getBoundingClientRect().height).toBeLessThanOrEqual(44);
    expect(getComputedStyle(screen.getByText("修复登录状态恢复").element()).whiteSpace).toBe(
      "nowrap",
    );

    await screen.getByRole("button", { name: "删除待办：修复登录状态恢复" }).click();
    expect(onDelete).toHaveBeenCalledWith("draft-a");
    expect(onRestore).not.toHaveBeenCalled();

    await restoreButton.click();
    expect(onRestore).toHaveBeenCalledWith("draft-a");
    expect(screen.getByRole("button", { name: "待办 2" }).element()).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("asks before replacing non-empty composer input", async () => {
    await i18n.changeLanguage("zh-CN");
    const onRestore = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ProjectDraftList
            composerHasInput
            drafts={drafts}
            onDelete={vi.fn()}
            onRestore={onRestore}
            projectName="CodeAgent"
          />
        </TooltipProvider>
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "待办 2" }).click();
    await screen.getByRole("button", { name: "修复登录状态恢复", exact: true }).click();

    await expect.element(screen.getByRole("dialog", { name: "覆盖当前输入？" })).toBeVisible();
    expect(onRestore).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "取消" }).click();
    expect(onRestore).not.toHaveBeenCalled();

    await screen.getByRole("button", { name: "待办 2" }).click();
    await screen.getByRole("button", { name: "修复登录状态恢复", exact: true }).click();
    await screen.getByRole("button", { name: "应用待办" }).click();
    expect(onRestore).toHaveBeenCalledWith("draft-a");
  });

  it("exposes an explicit save action", async () => {
    await i18n.changeLanguage("zh-CN");
    const onSave = vi.fn();
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ComposerDraftSaveButton disabled={false} editing={true} onSave={onSave} />
        </TooltipProvider>
      </I18nextProvider>,
    );

    await screen.getByRole("button", { name: "保存待办修改" }).click();
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "保存待办修改" }).element().querySelector("svg"))
      .toHaveClass("lucide-file-pen-line");
  });

  it("labels a new saved item as a todo", async () => {
    await i18n.changeLanguage("zh-CN");
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <ComposerDraftSaveButton disabled={false} editing={false} onSave={vi.fn()} />
        </TooltipProvider>
      </I18nextProvider>,
    );

    await expect.element(screen.getByRole("button", { name: "保存为待办" })).toBeVisible();
  });
});
