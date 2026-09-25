import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";
import type { ProjectGitStatus } from "@/protocol/index.js";
import { CommitChangesTreeSection } from "./commit-changes-tree.js";
import "../../../shared/styles/globals.css";

it.for(["tree", "list"] as const)("万级文件仅挂载可见行，滚动到底仍能预览末尾文件（%s）", async (viewMode) => {
  const changes: ProjectGitStatus["unstaged"] = Array.from({ length: 10_000 }, (_, index) => ({
    path: `file-${String(index).padStart(5, "0")}.txt`, kind: "update", diff: "", stats: { additions: 0, removals: 0 },
  }));
  const open = vi.fn();
  function Harness() {
    const [selected, setSelected] = useState(new Set<string>());
    return <div style={{ height: 400, width: 500 }}>
      <CommitChangesTreeSection viewMode={viewMode} changes={changes} label="Changes" onOpenFileDiff={open} onSelectedPathsChange={setSelected} selectedPaths={selected} />
    </div>;
  }
  const screen = await render(<Harness />);
  expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThan(80);
  const scroll = document.querySelector<HTMLElement>('[data-slot="commit-changes-scroll"]');
  expect(scroll).not.toBeNull();
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  await screen.getByRole("treeitem", { name: "file-09999.txt", exact: true }).click();
  expect(open).toHaveBeenCalledWith(changes[9999]);
});

it("打开提交面板不请求整仓 Diff", async () => {
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { CommitChangesController } = await import("./commit-changes-controller.js");
  const { nativeClient } = await import("../../projects/project-queries.js");
  const { TooltipProvider } = await import("../../../shared/components/core/tooltip.js");
  const queryClient = new QueryClient();
  const status: ProjectGitStatus = { branch: "main", baseBranches: [], branches: [], repositoryMode: "root", snapshot: "test", stats: { additions: 7, removals: 3 }, staged: [], unstaged: [{ path: "file.txt", kind: "update", diff: "", stats: { additions: 7, removals: 3 } }] };
  const getProjectGitStatus = vi.spyOn(nativeClient, "getProjectGitStatus").mockResolvedValue(status);
  const screen = await render(<QueryClientProvider client={queryClient}><TooltipProvider><div style={{ height: 500, width: 400 }}>
    <CommitChangesController client={nativeClient} gitStatus={status} onOpenFileDiff={vi.fn()} projectId="p" rootPath="/repo" />
  </div></TooltipProvider></QueryClientProvider>);
  await expect.element(screen.getByRole("treeitem", { name: "file.txt", exact: true })).toBeVisible();
  await expect.element(screen.getByLabelText("+7 -3", { exact: true })).toBeVisible();
  expect(getProjectGitStatus).not.toHaveBeenCalled();
  queryClient.clear();
  getProjectGitStatus.mockRestore();
});
