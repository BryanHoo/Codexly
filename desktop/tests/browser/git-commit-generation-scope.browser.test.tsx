import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CommitChangesPanel as WebPanel } from "../../../apps/web/src/features/workbench/components/commit-changes-panel.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { CommitChangesPanel as DesktopPanel } from "../../src/features/workbench/components/commit-changes-panel.js";
import { changeAppLanguage as desktopLanguage } from "../../src/i18n/i18n.js";
import { TooltipProvider } from "../../src/shared/components/core/tooltip.js";
import "../../src/shared/styles/globals.css";

it.each([
  ["Web", WebPanel, webLanguage, 390],
  ["桌面", DesktopPanel, desktopLanguage, 900],
] as const)(
  "%s AI 生成只提交选中顺序的前 500 个文件",
  async (platform, Panel, setLanguage, width) => {
    await setLanguage("zh-CN");
    const paths = Array.from(
      { length: 501 },
      (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`,
    );
    const snapshot = "a".repeat(64);
    const onGenerateMessage = vi.fn().mockResolvedValue("fix(git): 更新文件");
    const screen = await render(
      <div style={{ height: 600, width }}>
        <TooltipProvider>
          <Panel
            draftScope={`git-generation-scope-${platform}`}
            gitStatus={{
              baseBranches: [],
              branches: [],
              branch: "main",
              repositoryMode: "root",
              snapshot,
              staged: [],
              // 反向提供 Git 状态，验证生成按面板的选中顺序取前 500 项。
              unstaged: paths.toReversed().map((path) => ({
                path,
                diff: "",
                kind: "update",
                stats: { additions: 0, removals: 0 },
              })),
            }}
            onCommit={() => Promise.resolve()}
            onGenerateMessage={onGenerateMessage}
            onOpenFileDiff={() => undefined}
            onPush={() => Promise.resolve()}
          />
        </TooltipProvider>
      </div>,
    );
    await screen.getByRole("button", { name: "AI 生成", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "提交信息", exact: true }))
      .toHaveValue("fix(git): 更新文件");
    expect(onGenerateMessage).toHaveBeenCalledExactlyOnceWith({
      expectedSnapshot: snapshot,
      paths: paths.slice(0, 500),
    });
  },
);
