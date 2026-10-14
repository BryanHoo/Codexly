import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CommitChangesPanel } from "./commit-changes-panel.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { i18n } from "../../../i18n/i18n.js";
import "../../../shared/styles/globals.css";

function SelectionWorkspace() {
  const [open, setOpen] = useState(true);
  const [snapshot, setSnapshot] = useState("a".repeat(64));
  const file = (path: string) => ({ path, kind: "update" as const, diff: "", stats: { additions: 0, removals: 0 } });
  return (
    <TooltipProvider>
      <button onClick={() => { setOpen((current) => !current); }}>{open ? "关闭变更" : "打开变更"}</button>
      <button onClick={() => { setSnapshot("b".repeat(64)); }}>刷新变更</button>
      <div style={{ height: 600, width: 420 }}>
        {open ? (
          <CommitChangesPanel
            draftScope="selection-reopen-test"
            gitStatus={{ branch: "feature/git", branches: [], baseBranches: [], repositoryMode: "root", snapshot, staged: [file("a.ts")], unstaged: [file("b.ts")] }}
            onCommit={vi.fn().mockResolvedValue(undefined)}
            onGenerateMessage={vi.fn().mockResolvedValue("")}
            onPush={vi.fn().mockResolvedValue(undefined)}
            onOpenFileDiff={vi.fn()}
          />
        ) : null}
      </div>
    </TooltipProvider>
  );
}

it("打开默认全选，刷新保留取消，重新打开恢复全选和草稿且没有审查提示", async () => {
  await i18n.changeLanguage("zh-CN");
  const screen = await render(<SelectionWorkspace />);
  const staged = screen.getByRole("checkbox", { name: "变更: a.ts", exact: true });
  const unstaged = screen.getByRole("checkbox", { name: "变更: b.ts", exact: true });
  const message = screen.getByRole("textbox", { name: "提交信息", exact: true });
  await expect.element(staged).toBeChecked();
  await expect.element(unstaged).toBeChecked();
  await message.fill("保留提交信息");
  await unstaged.click();
  await screen.getByRole("button", { name: "刷新变更", exact: true }).click();
  await expect.element(unstaged).not.toBeChecked();
  expect(document.querySelector('[data-slot="commit-changes-panel"]')?.textContent).not.toMatch(/变更范围已更新|已审查/u);
  await screen.getByRole("button", { name: "关闭变更", exact: true }).click();
  await screen.getByRole("button", { name: "打开变更", exact: true }).click();
  await expect.element(staged).toBeChecked();
  await expect.element(unstaged).toBeChecked();
  await expect.element(message).toHaveValue("保留提交信息");
});
