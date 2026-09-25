import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ProjectGitStatus } from "@/protocol/index.js";
import { useCommitStatusPages } from "./use-commit-status-pages.js";

it("按需追加同快照页面，过期游标的新首页替换旧列表", async () => {
  const file = (path: string) => ({ path, kind: "update" as const, diff: "", stats: { additions: 0, removals: 0 } });
  const initial: ProjectGitStatus = { branch: "main", baseBranches: [], branches: [], repositoryMode: "root", snapshot: "old", staged: [file("first")], unstaged: [], nextCursor: "old:1", totalChanges: 3 };
  const getProjectGitStatus = vi.fn().mockResolvedValueOnce({ ...initial, staged: [file("second")], nextCursor: "old:2" }).mockResolvedValueOnce({ ...initial, snapshot: "new", staged: [file("replacement")], nextCursor: null });
  const queryClient = new QueryClient();
  function Harness() {
    const { status, loadMore } = useCommitStatusPages({ getProjectGitStatus }, "p", "/repo", null, initial);
    return <><output>{status.staged.map((change) => change.path).join(",")}</output><button onClick={() => void loadMore()}>加载</button></>;
  }
  const screen = await render(<QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>);
  expect(getProjectGitStatus).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "加载" }).click();
  await expect.element(screen.getByText("first,second", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "加载" }).click();
  await expect.element(screen.getByText("replacement", { exact: true })).toBeVisible();
  expect(getProjectGitStatus.mock.calls[0]?.[1]).toEqual({ rootPath: "/repo", cursor: "old:1" });
  queryClient.clear();
});
