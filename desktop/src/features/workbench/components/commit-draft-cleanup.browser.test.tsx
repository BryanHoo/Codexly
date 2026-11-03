import { useState } from "react";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CommitChangesPanel as DesktopPanel } from "./commit-changes-panel.js";
import { CommitChangesPanel as WebPanel } from "../../../../../apps/web/src/features/workbench/components/commit-changes-panel.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { i18n } from "../../../i18n/i18n.js";
import "../../../shared/styles/globals.css";

for (const [platform, Panel] of [["desktop", DesktopPanel], ["web", WebPanel]] as const) {
  it.each([
    { closeDuringCommit: true, succeeds: true },
    { closeDuringCommit: false, succeeds: true },
    { closeDuringCommit: true, succeeds: false },
  ])(`${platform} 提交完成后按结果清理草稿：%j`, async ({ closeDuringCommit, succeeds }) => {
    await i18n.changeLanguage("zh-CN");
    const draftScope = `commit-cleanup-${platform}-${String(closeDuringCommit)}-${String(succeeds)}`;
    const storageKey = `codexly:git-draft:v1:${JSON.stringify([draftScope, "main"])}`;
    localStorage.removeItem(storageKey);
    let finish: () => void = () => undefined;
    let fail: (error: Error) => void = () => undefined;
    const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    function Harness() {
      const [open, setOpen] = useState(true);
      return <TooltipProvider>
        <button onClick={() => { setOpen(true); }}>重新打开</button>
        <button onClick={() => { if (succeeds) finish(); else fail(new Error("commit failed")); }}>完成提交</button>
        {open ? <div style={{ width: 420, height: 600 }}><Panel
          draftScope={draftScope}
          gitStatus={{ branch: "main", branches: [], baseBranches: [], repositoryMode: "root", snapshot: "a".repeat(64), staged: [], unstaged: [{ path: "app.ts", kind: "update", diff: "", stats: { additions: 1, removals: 0 } }] }}
          onCommit={async () => { if (closeDuringCommit) setOpen(false); await pending; }}
          onPush={vi.fn().mockResolvedValue(undefined)}
          onGenerateMessage={vi.fn().mockResolvedValue("")}
          onOpenFileDiff={vi.fn()}
        /></div> : null}
      </TooltipProvider>;
    }
    const screen = await render(<Harness />);
    const message = screen.getByRole("textbox", { name: "提交信息", exact: true });
    const submitted = "fix(git): 清除已提交信息";
    await message.fill(submitted);
    await screen.getByRole("button", { name: "提交", exact: true }).click();
    await expect.poll(() => document.querySelector('textarea[aria-label="提交信息"]') === null).toBe(closeDuringCommit);
    await screen.getByRole("button", { name: "完成提交", exact: true }).click();
    await expect.poll(() => JSON.parse(localStorage.getItem(storageKey) ?? "null")).toMatchObject({ message: succeeds ? "" : submitted, previousMessage: null });
    await screen.getByRole("button", { name: "重新打开", exact: true }).click();
    await expect.element(message).toHaveValue(succeeds ? "" : submitted);
  });
}
