import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextMenu } from "../../../shared/components/core/context-menu.js";
import { GitHistoryPanel } from "./git-history-panel.js";
import { i18n } from "../../../i18n/i18n.js";
import {
  copyGitCommitText,
  GitHistoryContent,
  getGitCommitCopyText,
  GitCommitContextMenuItems,
} from "./git-history-list.js";

const commit = {
  authoredAt: "2026-08-18T08:30:00+08:00",
  authorEmail: "developer@example.com",
  authorName: "Developer",
  sha: "a".repeat(40),
  title: "feat(git): 渲染右栏历史",
} as const;

describe("GitCommitContextMenuItems", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("渲染三项提交复制命令", () => {
    const markup = renderToStaticMarkup(
      <ContextMenu open>
        <GitCommitContextMenuItems commit={commit} />
      </ContextMenu>,
    );

    expect(markup).toContain("复制提交信息");
    expect(markup).toContain("复制提交人");
    expect(markup).toContain("复制完整提交哈希值");
    expect(markup.match(/data-slot="context-menu-item"/gu)).toHaveLength(3);
  });

  it("返回各复制命令对应的完整提交值", () => {
    expect(getGitCommitCopyText(commit, "message")).toBe(commit.title);
    expect(getGitCommitCopyText(commit, "author")).toBe(commit.authorName);
    expect(getGitCommitCopyText(commit, "hash")).toBe(commit.sha);
  });

  it("将选中的提交值写入系统剪贴板", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    copyGitCommitText(commit, "hash");

    expect(writeText).toHaveBeenCalledWith(commit.sha);
  });
});

describe("GitHistoryPanel", () => {
  it.each([
    ["zh-CN", "未推送"],
    ["en", "Unpushed"],
  ])("marks only confirmed unpushed commits in %s", async (language, label) => {
    await i18n.changeLanguage(language);
    try {
      const markup = renderToStaticMarkup(
        <GitHistoryContent
          active
          compact
          dateFormatter={new Intl.DateTimeFormat("en")}
          panelId="test-history"
          query={{
            data: {
              pages: [
                {
                  branch: "main",
                  commits: [
                    { ...commit, unpushed: true },
                    { ...commit, sha: "b".repeat(40), unpushed: false },
                    { ...commit, sha: "c".repeat(40) },
                  ],
                  nextCursor: null,
                  repositories: [],
                  repository: null,
                  repositoryMode: "root",
                },
              ],
            },
            error: null,
            fetchNextPage: () => undefined,
            hasNextPage: false,
            isFetchingNextPage: false,
            isPending: false,
            refetch: () => undefined,
          }}
        />,
      );
      expect(markup.match(/data-slot="git-unpushed-badge"/gu)).toHaveLength(1);
      expect(markup).toContain(label);
    } finally {
      await i18n.changeLanguage("zh-CN");
    }
  });
  it("在右栏内容区展示仓库历史且不渲染 Sheet 外壳", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["projects", "codexly", "/workspace/Codexly", "git-history", null], {
      pageParams: [undefined],
      pages: [
        {
          branch: "feat/inspector-history",
          commits: [commit],
          nextCursor: "20",
          repositories: [],
          repository: null,
          repositoryMode: "root",
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
    expect(markup).not.toContain('aria-label="子仓库"');
    expect(markup).toContain("feat(git): 渲染右栏历史");
    expect(markup).toContain('data-slot="context-menu-trigger"');
    expect(markup).toMatch(/class="[^"]*w-full[^"]*"[^>]*data-size="sm"[^>]*>加载更多/u);
    expect(markup).not.toContain('data-slot="sheet-content"');
    expect(markup).not.toContain('aria-label="关闭 Git 历史"');
  });
});
