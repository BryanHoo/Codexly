import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { CommitProjectChangesResponse, ProjectGitStatus } from "@/protocol/index.js";
import { nativeClient } from "../../projects/project-queries.js";
import { i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { CommitChangesController } from "./commit-changes-controller.js";
import "../../../shared/styles/globals.css";

afterEach(() => { vi.restoreAllMocks(); });

it("提交期间提前到达的元数据不触发远端检查，结束后直接显示待推送", async () => {
  await i18n.changeLanguage("zh-CN");
  const projectId = "commit-refresh-browser-test";
  const rootPath = "/commit-refresh-browser-test";
  const before: ProjectGitStatus = {
    baseBranches: [], branch: "main", branches: ["main"], repositoryMode: "root",
    snapshot: "a".repeat(64), staged: [], totalChanges: 1,
    unstaged: [{ path: "app.ts", kind: "update", diff: "+new", stats: { additions: 1, removals: 0 } }],
  };
  const after: ProjectGitStatus = {
    ...before, snapshot: "b".repeat(64), unstaged: [], totalChanges: 0,
  };
  let writing = false;
  let currentStatus = before;
  let finish: (result: CommitProjectChangesResponse) => void = () => undefined;
  const pending = new Promise<CommitProjectChangesResponse>((resolve) => { finish = resolve; });
  vi.spyOn(nativeClient, "getProjectGitStatus").mockImplementation(() => Promise.resolve(currentStatus));
  vi.spyOn(nativeClient, "commitProjectChanges").mockImplementation(() => {
    writing = true;
    return pending;
  });
  const inspect = vi.spyOn(nativeClient, "pushProjectCommits").mockImplementation(() => {
    if (writing) return Promise.reject(new Error("Another Git mutation is already in progress"));
    return Promise.resolve({
      branch: "main", pushStatus: "checked", pushError: null,
      remoteState: {
        head: (currentStatus === before ? "a" : "b").repeat(40),
        upstream: "origin/main", remote: "origin", targetBranch: "main",
        remotes: [{ name: "origin", url: "https://example.com/repo.git" }],
        ahead: currentStatus === before ? 0 : 1, behind: 0,
        checkedAt: "2026-10-14T00:00:00Z", operation: "none", conflicts: [],
      },
    });
  });
  const queryClient = new QueryClient();
  const statusKey = ["projects", projectId, rootPath, "git-status"];
  const remoteKey = ["projects", projectId, rootPath, "git-remote", "main", after.snapshot];
  function Harness() {
    const status = useQuery({
      queryKey: statusKey, initialData: before, staleTime: Infinity,
      queryFn: () => nativeClient.getProjectGitStatus(projectId, { rootPath }),
    });
    return <TooltipProvider><div style={{ width: 360, height: 600 }}>
      <CommitChangesController client={nativeClient} projectId={projectId} rootPath={rootPath}
        gitStatus={status.data} onOpenFileDiff={() => undefined} />
    </div></TooltipProvider>;
  }
  const screen = await render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
  try {
    await expect.element(screen.getByText("已同步", { exact: true })).toBeVisible();
    await screen.getByRole("textbox", { name: "提交信息", exact: true }).fill("fix(git): 验证提交后刷新");
    await screen.getByRole("button", { name: "提交", exact: true }).click();
    await vi.waitFor(() => { expect(writing).toBe(true); });
    // 模拟仓库监听先于提交响应发布新快照，原实现会在写入未结束时请求并留下错误。
    currentStatus = after;
    queryClient.setQueryData(statusKey, after);
    await expect.poll(() => queryClient.getQueryState(remoteKey)?.fetchStatus).toBe("idle");
    expect(inspect).toHaveBeenCalledTimes(1);
    writing = false;
    finish({
      branch: "main", commitSha: "b".repeat(40), message: "fix(git): 验证提交后刷新",
      pushError: null, pushStatus: "not_requested", indexSyncError: null,
    });
    await expect.element(screen.getByText("待推送 1 个提交", { exact: true })).toBeVisible();
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryState(remoteKey)?.error).toBeNull();
    expect(document.querySelector('[data-slot="git-remote-notice"]')).toBeNull();
    await expect.element(screen.getByRole("button", { name: "推送", exact: true })).toBeEnabled();
  } finally {
    queryClient.clear();
  }
});
