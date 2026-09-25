import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ProjectGitStatus } from "@/protocol/index.js";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { FileReviewDialog } from "../../diff/file-review-dialog.js";
import { nativeClient } from "../../projects/project-queries.js";
import "../../../shared/styles/globals.css";
import { WorkbenchInspector, type WorkbenchInspectorTab } from "./workbench-inspector.js";

const status: ProjectGitStatus = {
  baseBranches: [], branch: "main", branches: [], repositoryMode: "root", snapshot: "current",
  staged: [],
  unstaged: [{ path: "main.ts", kind: "update", diff: "", stats: { additions: 0, removals: 0 } }],
};
const details: ProjectGitStatus = {
  ...status,
  unstaged: [{ ...status.unstaged[0]!, diff: "--- a/main.ts\n+++ b/main.ts\n@@ -1,2 +1,5 @@\n-old\n-old2\n+one\n+two\n+three\n+four\n+five\n", stats: { additions: 5, removals: 2 } }],
};

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("color-scheme");
});

it.for([{ width: 1280, theme: "light" }, { width: 1920, theme: "dark" }])("项目页等待真实统计，审核打开弹窗，提交切换变更，上下文移除变更模块（$width / $theme）", async ({ width, theme }) => {
  document.documentElement.style.colorScheme = theme;
  await page.viewport(width, 720);
  vi.spyOn(nativeClient, "listProjectFiles").mockResolvedValue({
    entries: [{ path: "main.ts", type: "file" }], path: null,
  });
  await i18n.changeLanguage("zh-CN");
  const review = vi.fn();
  const queryClient = new QueryClient();
  function Harness() {
    const [tab, setTab] = useState<WorkbenchInspectorTab>("project");
    const [loaded, setLoaded] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    return <QueryClientProvider client={queryClient}><TooltipProvider>
      <button onClick={() => setLoaded(true)}>加载详情</button>
      <div style={{ height: 640, width: 360, display: "flex" }}>
        <WorkbenchInspector projectName="Project" projectId="project" projectPath="/project"
          projectRootId="root" taskId="task" tab={tab} onTabChange={setTab}
          gitStatus={status} gitStatusDetails={loaded ? details : undefined}
          onCommitChanges={() => setTab("changes")}
          onReviewFileChanges={(changes) => { review(changes); setReviewOpen(true); }} />
      </div>
      <FileReviewDialog changes={reviewOpen ? details.unstaged : null} onClose={() => setReviewOpen(false)} />
    </TooltipProvider></QueryClientProvider>;
  }
  const screen = await render(<Harness />);
  const reviewButton = screen.getByRole("button", { name: "审核", exact: true });
  await expect.element(screen.getByText("1 个文件", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("未提交变更", { exact: true })).not.toBeInTheDocument();
  await expect.element(reviewButton).toBeVisible();
  await expect.element(reviewButton).toBeEnabled();
  await expect.element(screen.getByText("+0", { exact: true })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "加载详情" }).click();
  await expect.element(screen.getByLabelText("main.ts，新增 5 行，删除 2 行")).toBeVisible();
  const summary = screen.getByRole("region", { name: "未提交变更", exact: true }).element();
  expect(summary.querySelectorAll("svg")).toHaveLength(0);
  expect(summary.parentElement!.getBoundingClientRect().height).toBeLessThanOrEqual(32);
  const countRect = screen.getByText("1 个文件", { exact: true }).element().getBoundingClientRect();
  const statsRect = summary.querySelector(".text-diff-added")!.getBoundingClientRect();
  const reviewRect = reviewButton.element().getBoundingClientRect();
  const commitRect = screen.getByRole("button", { name: /提交.*变更/u }).element().getBoundingClientRect();
  expect(statsRect.left).toBeGreaterThanOrEqual(countRect.right);
  expect(statsRect.top).toBeLessThan(countRect.bottom);
  for (const button of summary.querySelectorAll("button")) {
    const background = getComputedStyle(button).backgroundColor;
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    expect(background).not.toBe(getComputedStyle(summary.closest("aside")!).backgroundColor);
  }
  expect(reviewRect.left).toBeGreaterThan(countRect.right);
  expect(commitRect.left).toBeGreaterThanOrEqual(reviewRect.right);
  expect(commitRect.top).toBe(reviewRect.top);
  await reviewButton.click();
  expect(review).toHaveBeenCalledExactlyOnceWith(details.unstaged);
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭文件审核", exact: true }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: /提交.*变更/u }).click();
  await expect.element(screen.getByRole("tab", { name: "变更", exact: true })).toHaveAttribute("aria-selected", "true");
  await screen.getByRole("tab", { name: "上下文", exact: true }).click();
  await expect.element(reviewButton).not.toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
});

it("仅有分页 numstat 元数据时，项目汇总与文件树直接显示增删行数", async () => {
  await i18n.changeLanguage("zh-CN");
  vi.spyOn(nativeClient, "listProjectFiles").mockResolvedValue({
    entries: [{ path: "main.ts", type: "file" }], path: null,
  });
  const readDiff = vi.spyOn(nativeClient, "getProjectGitStatus");
  const counted: ProjectGitStatus = {
    ...status, totalChanges: 1500, stats: { additions: 3000, removals: 1500 },
    unstaged: [{ ...status.unstaged[0]!, stats: { additions: 7, removals: 3 } }],
  };
  const queryClient = new QueryClient();
  const screen = await render(<QueryClientProvider client={queryClient}><TooltipProvider>
    <div style={{ height: 640, width: 360, display: "flex" }}>
      <WorkbenchInspector projectName="Project" projectId="project" projectPath="/project"
        projectRootId="root" taskId="task" tab="project" gitStatus={counted} />
    </div>
  </TooltipProvider></QueryClientProvider>);
  await expect.element(screen.getByText("+3000", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("-1500", { exact: true })).toBeVisible();
  await expect.element(screen.getByLabelText("main.ts，新增 7 行，删除 3 行")).toBeVisible();
  expect(readDiff).not.toHaveBeenCalled();
  queryClient.clear();
});
