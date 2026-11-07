import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CommitChangesPanel as DesktopPanel } from "../../src/features/workbench/components/commit-changes-panel.js";
import { CommitChangesPanel as WebPanel } from "../../../apps/web/src/features/workbench/components/commit-changes-panel.js";
import { i18n as desktopI18n } from "../../src/i18n/i18n.js";
import { i18n as webI18n } from "../../../apps/web/src/i18n/i18n.js";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import "../../src/shared/styles/globals.css";
for (const [name, Panel] of [["desktop", DesktopPanel], ["web", WebPanel]] as const) {
 it(`${name}: confirms the fixed selected paths, supports cancel and preserves failures for retry`, async () => {
  await desktopI18n.changeLanguage("zh-CN"); await webI18n.changeLanguage("zh-CN");
  const discard = vi.fn().mockRejectedValueOnce(new Error("工作区已变化")).mockResolvedValue(undefined);
  const screen = await render(<div style={{width:360,height:650}}><TooltipProvider><Panel draftScope={`discard-${name}`} gitStatus={{repositoryMode:"root",branch:"main",branches:[],baseBranches:[],snapshot:"a".repeat(64),staged:[],unstaged:[{path:"a.txt",kind:"update",diff:"",stats:{additions:0,removals:0}},{path:"b.txt",kind:"create",diff:"",stats:{additions:0,removals:0}}]}} onDiscard={discard} onCommit={vi.fn()} onPush={vi.fn()} onGenerateMessage={vi.fn()} onOpenFileDiff={vi.fn()} /></TooltipProvider></div>);
  await expect.element(screen.getByRole("button",{name:"丢弃所选变更",exact:true})).not.toBeInTheDocument();
  await screen.getByRole("button",{name:"更多变更操作",exact:true}).click();
  await expect.element(screen.getByText("已选择 2 个文件",{exact:true})).toBeVisible();
  await page.screenshot({path:`../../test-results/discard-menu-${name}.png`});
  await screen.getByRole("menuitem",{name:"丢弃所选变更",exact:true}).click();
  await expect.element(screen.getByRole("dialog").getByText("a.txt",{exact:true})).toBeVisible();
  await screen.getByRole("button",{name:"取消",exact:true}).click(); expect(discard).not.toHaveBeenCalled();
  await screen.getByRole("checkbox",{name:"变更: b.txt",exact:true}).click();
  await screen.getByRole("button",{name:"更多变更操作",exact:true}).click();
  await screen.getByRole("menuitem",{name:"丢弃所选变更",exact:true}).click();
  await screen.getByRole("button",{name:"确认丢弃",exact:true}).click();
  await expect.element(screen.getByRole("dialog").getByText("工作区已变化",{exact:true})).toBeVisible();
  await screen.getByRole("button",{name:"确认丢弃",exact:true}).click();
  expect(discard).toHaveBeenLastCalledWith({paths:["a.txt"],expectedSnapshot:"a".repeat(64)});
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await screen.getByRole("button",{name:"更多变更操作",exact:true}).click();
  await expect.element(screen.getByRole("menuitem",{name:"丢弃所选变更",exact:true})).toBeDisabled();
 });
 it(`${name}: row discard confirms only that file without opening its diff`, async () => {
  await desktopI18n.changeLanguage("zh-CN"); await webI18n.changeLanguage("zh-CN");
  const discard = vi.fn().mockResolvedValue(undefined); const open = vi.fn();
  const screen = await render(<div style={{width:360,height:650}}><TooltipProvider><Panel draftScope={`discard-row-${name}`} gitStatus={{repositoryMode:"root",branch:"main",branches:[],baseBranches:[],snapshot:"a".repeat(64),staged:[],unstaged:[{path:"a.txt",kind:"update",diff:"",stats:{additions:0,removals:0}},{path:"b.txt",kind:"create",diff:"",stats:{additions:0,removals:0}}]}} onDiscard={discard} onCommit={vi.fn()} onPush={vi.fn()} onGenerateMessage={vi.fn()} onOpenFileDiff={open} /></TooltipProvider></div>);
  const action = screen.getByRole("button",{name:"丢弃变更: a.txt",exact:true});
  action.element().focus();
  await page.screenshot({path:`../../test-results/discard-row-${name}.png`});
  await action.click();
  await expect.element(screen.getByRole("dialog").getByText("a.txt",{exact:true})).toBeVisible();
  await expect.element(screen.getByRole("dialog").getByText("b.txt",{exact:true})).not.toBeInTheDocument();
  expect(open).not.toHaveBeenCalled();
  await screen.getByRole("button",{name:"确认丢弃",exact:true}).click();
  expect(discard).toHaveBeenCalledExactlyOnceWith({paths:["a.txt"],expectedSnapshot:"a".repeat(64)});
  await expect.element(screen.getByRole("checkbox",{name:"变更: b.txt",exact:true})).toBeChecked();
 });

}
