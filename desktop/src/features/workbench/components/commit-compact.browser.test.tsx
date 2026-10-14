import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { CommitChangesPanel } from "./commit-changes-panel.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { i18n } from "../../../i18n/i18n.js";
import "../../../shared/styles/globals.css";

it("软键盘压缩视口后，提交区域仍位于面板内且可滚动到主操作", async () => {
  await i18n.changeLanguage("zh-CN");
  await page.viewport(390, 300);
  const screen = await render(
    <div style={{ height: 300, width: 390, display: "flex", flexDirection: "column" }}>
      <TooltipProvider>
        <CommitChangesPanel
          draftScope="compact-layout-test"
          gitStatus={{
            branch: "feature/git",
            branches: [],
            baseBranches: [],
            repositoryMode: "root",
            snapshot: "a".repeat(64),
            staged: [],
            unstaged: [
              { path: "file.ts", kind: "update", diff: "", stats: { additions: 0, removals: 0 } },
            ],
          }}
          onCommit={vi.fn().mockResolvedValue(undefined)}
          onGenerateMessage={vi.fn().mockResolvedValue("")}
          onPush={vi.fn().mockResolvedValue(undefined)}
          onOpenFileDiff={vi.fn()}
          pushResult={{
            branch: "feature/git",
            pushStatus: "failed",
            pushError: "[rejected] non-fast-forward",
          }}
        />
      </TooltipProvider>
    </div>,
  );
  // CI 默认使用英语；切换中文时初始英语资源仍可能在加载，React 会暂缓挂载。
  // 等待实际节点出现后再测量，避免把 render 返回误当作异步初始化已经完成。
  await expect
    .poll(() => screen.container.querySelector('[data-slot="git-commit-footer"]'))
    .not.toBeNull();
  const footer = screen.container.querySelector<HTMLElement>('[data-slot="git-commit-footer"]');
  const panel = screen.container.querySelector<HTMLElement>('[data-slot="commit-changes-panel"]');
  expect(footer).not.toBeNull();
  expect(panel).not.toBeNull();
  if (!footer || !panel) throw new Error("Git workspace did not mount");
  expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    panel.getBoundingClientRect().bottom,
  );
  footer.scrollTop = footer.scrollHeight;
  await expect.element(screen.getByRole("button", { name: "提交", exact: true })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "提交", exact: true }).element().getBoundingClientRect()
      .bottom,
  ).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
});
