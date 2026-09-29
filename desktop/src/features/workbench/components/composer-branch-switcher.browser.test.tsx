import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { ComposerBranchSwitcher } from "./composer-branch-switcher.js";
import "../../../shared/styles/globals.css";

it("keeps branch actions and removes worktree actions from the composer", async () => {
  await i18n.changeLanguage("zh-CN");
  const change = vi.fn();
  const createBranch = vi.fn(async () => true);
  const screen = await render(<I18nextProvider i18n={i18n}>
    <ComposerBranchSwitcher creatingBranch={undefined} switchingBranch={undefined}
      gitStatus={{ baseBranches: ["main"], branch: "main", branches: ["main", "topic"], repositoryMode: "root", snapshot: "a".repeat(64), staged: [], unstaged: [] }}
      onBranchChange={change} onBranchCreate={createBranch} />
  </I18nextProvider>);
  const trigger = screen.getByRole("button", { name: "切换分支，当前分支 main" });
  await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
  await trigger.click();
  await screen.getByRole("menuitemradio", { name: "topic" }).click();
  expect(change).toHaveBeenCalledWith("topic");
  await trigger.click();
  await screen.getByRole("menuitem", { name: "新建分支", exact: true }).click();
  await expect.element(screen.getByRole("dialog", { name: "新建分支" })).toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "分支名称" })).toHaveFocus();
  await screen.getByRole("textbox", { name: "分支名称" }).fill("feature/terminal");
  await screen.getByRole("button", { name: "创建并切换" }).click();
  expect(createBranch).toHaveBeenCalledWith("feature/terminal");
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await trigger.click();
  await expect.element(screen.getByRole("menuitem", { name: "新建 worktree" })).not.toBeInTheDocument();
  await expect.element(screen.getByText("切换 worktree")).not.toBeInTheDocument();
});
