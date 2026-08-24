import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GitHistoryPanel } from "./git-history-panel.js";

describe("GitHistoryPanel", () => {
  it("在右栏内容区展示仓库历史且不渲染 Sheet 外壳", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["projects", "codexly", "/workspace/Codexly", "git-history", null], {
      pageParams: [undefined],
      pages: [
        {
          branch: "feat/inspector-history",
          commits: [
            {
              authoredAt: "2026-08-18T08:30:00+08:00",
              authorEmail: "developer@example.com",
              authorName: "Developer",
              sha: "a".repeat(40),
              title: "feat(git): 渲染右栏历史",
            },
          ],
          nextCursor: "20",
          repositories: ["apps/web", "packages/server"],
          repository: "apps/web",
          repositoryMode: "children",
        },
      ],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <GitHistoryPanel
          client={{
            getProjectGitCommitFileDiff: vi.fn(),
            getProjectGitCommitFiles: vi.fn(),
            getProjectGitHistory: vi.fn(),
          }}
          projectId="codexly"
          rootPath="/workspace/Codexly"
        />
      </QueryClientProvider>,
    );

    expect(markup).toContain('data-slot="git-history-panel"');
    expect(markup).toContain("当前分支：feat/inspector-history");
    expect(markup).toContain('aria-label="子仓库"');
    expect(markup).toContain("feat(git): 渲染右栏历史");
    expect(markup).toMatch(/class="[^"]*w-full[^"]*"[^>]*data-size="sm"[^>]*>加载更多/u);
    expect(markup).not.toContain('data-slot="sheet-content"');
    expect(markup).not.toContain('aria-label="关闭 Git 历史"');
  });
});
