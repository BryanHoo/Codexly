import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { CommitChangesPanel, collectCommitFileEntries } from "./commit-changes-panel.js";
import { CommitChangesTreeSection } from "./commit-changes-tree.js";

const gitStatus = {
  baseBranches: ["origin/main"],
  branch: "feat/commit",
  branches: ["feat/commit", "main"],
  repositoryMode: "root" as const,
  snapshot: "a".repeat(64),
  staged: [{ diff: "+staged", kind: "update" as const, path: "src/app.ts" }],
  unstaged: [
    { diff: "+unstaged", kind: "update" as const, path: "src/app.ts" },
    { diff: "+new", kind: "create" as const, path: "src/new.ts" },
  ],
};

const cleanGitStatus = { ...gitStatus, staged: [], unstaged: [] };
const commitResult = {
  branch: "feat/commit",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  history: {
    branch: "feat/commit",
    commits: [],
    nextCursor: null,
    repositories: [],
    repository: null,
    repositoryMode: "root" as const,
  },
  message: "feat(git): 提交选择文件",
  pushError: null,
  pushStatus: "not_requested" as const,
  status: cleanGitStatus,
};

function renderPanel(overrides: Partial<ComponentProps<typeof CommitChangesPanel>> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CommitChangesPanel
        gitStatus={gitStatus}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
        onOpenFileDiff={() => undefined}
        onPush={() => Promise.resolve()}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("CommitChangesPanel", () => {
  it("keeps an enabled push action with an empty working tree and no commit message", () => {
    const markup = renderPanel({ gitStatus: cleanGitStatus });
    expect(markup).toMatch(/<button[^>]*aria-label="推送"[^>]*>/u);
    expect(/<button[^>]*aria-label="推送"[^>]*>/u.exec(markup)?.[0]).not.toMatch(
      / disabled(?:=|\s|>)/u,
    );
    expect(markup).not.toContain('id="commit-message"');
    expect(markup).not.toContain('data-slot="commit-changes-scroll"');
    expect(markup).toContain("暂无未提交变更");
  });

  it("disables push while a Git action is pending", () => {
    const markup = renderPanel({ gitStatus: cleanGitStatus, isPushing: true });
    expect(/<button[^>]*aria-label="推送中…"[^>]*>/u.exec(markup)?.[0]).toMatch(
      / disabled(?:=|\s|>)/u,
    );
  });

  it("keeps only commit and an available more-actions menu when files are changed", () => {
    const markup = renderPanel();
    expect(markup).not.toContain('aria-label="推送"');
    expect(markup).toContain('aria-label="更多 Git 操作"');
    expect(/<button[^>]*aria-label="更多 Git 操作"[^>]*>/u.exec(markup)?.[0]).not.toMatch(
      / disabled(?:=|\s|>)/u,
    );
  });

  it("shows a local commit confirmation and makes push the next primary action", () => {
    const markup = renderPanel({ gitStatus: cleanGitStatus, result: commitResult });
    expect(markup).toContain("已保存到本地");
    expect(markup).toContain("0123456");
    expect(markup).toContain('aria-label="推送"');
    expect(markup).not.toContain('id="commit-message"');
  });

  it("shows a retry action for a failed push without repeating commit", () => {
    const markup = renderPanel({
      gitStatus: cleanGitStatus,
      result: { ...commitResult, pushStatus: "failed", pushError: "remote rejected" },
    });
    expect(markup).toContain("提交已保存，推送未完成");
    expect(markup).toContain('aria-label="重试推送"');
    expect(markup).not.toContain('id="commit-message"');
  });

  it("shows the actual push result and disables another push for the same snapshot", () => {
    const markup = renderPanel({
      gitStatus: cleanGitStatus,
      result: commitResult,
      pushResult: { branch: "feat/commit", pushStatus: "pushed", pushError: null },
    });
    expect(markup).toContain("已推送到远端");
    expect(/<button[^>]*aria-label="已推送"[^>]*>/u.exec(markup)?.[0]).toMatch(
      / disabled(?:=|\s|>)/u,
    );
    expect(markup).not.toContain("已保存到本地，尚未推送");
  });

  it("allows committing remaining files after a partial commit", () => {
    const markup = renderPanel({ result: { ...commitResult, status: gitStatus } });
    expect(/<textarea[^>]*id="commit-message"[^>]*>/u.exec(markup)?.[0]).not.toMatch(
      / disabled(?:=|\s|>)/u,
    );
    expect(markup).toContain(">提交</button>");
  });
  it("renders commit controls and change trees without a sheet or branch history", () => {
    expect(collectCommitFileEntries(gitStatus)).toEqual([
      { path: "src/app.ts", staged: true, unstaged: true },
      { path: "src/new.ts", staged: false, unstaged: true },
    ]);

    const markup = renderPanel();

    expect(markup).toContain('data-slot="commit-changes-panel"');
    expect(markup).toContain('aria-label="已暂存"');
    expect(markup).toContain('aria-label="未暂存"');
    expect(markup.match(/data-ai-file-tree=""/gu)).toHaveLength(2);
    expect(markup).toContain('aria-label="生成 message 信息"');
    expect(markup).toContain('id="commit-message"');
    const commitMessageClasses = /<textarea class="([^"]+)"[^>]*id="commit-message"/u.exec(
      markup,
    )?.[1];
    expect(commitMessageClasses).toContain("focus-visible:!outline-none");
    expect(markup).toContain(">提交</button>");
    expect(markup).toContain('aria-label="更多 Git 操作"');
    expect(markup).toContain('data-slot="commit-changes-scroll"');
    expect(markup).toContain('aria-label="切换为文件列表"');
    expect(markup).not.toContain('data-slot="sheet-content"');
    expect(markup).not.toContain('data-slot="commit-history-scroll"');
    expect(markup).not.toContain('data-slot="git-history-content"');
    expect(markup).not.toContain("当前分支历史");
    expect(markup).not.toContain("feat/commit");
  });

  it("renders a flat file list with full relative paths", () => {
    const markup = renderToStaticMarkup(
      <CommitChangesTreeSection
        changes={gitStatus.unstaged}
        label="未暂存"
        onOpenFileDiff={() => undefined}
        onSelectedPathsChange={() => undefined}
        selectedPaths={new Set(["src/app.ts"])}
        viewMode="list"
      />,
    );

    expect(markup).toContain('data-slot="commit-changes-list"');
    expect(markup).toContain("src/app.ts");
    expect(markup).toContain("src/new.ts");
    expect(markup).toContain('aria-label="未暂存: src/app.ts"');
    expect(markup).toContain(
      'class="flex min-h-7 items-center gap-1.5 rounded-control px-2 hover:bg-control-hover"',
    );
    expect(markup).not.toContain('data-ai-file-tree=""');
  });

  it.each(["none", "children"] as const)(
    "renders no commit controls for %s projects",
    (repositoryMode) => {
      expect(renderPanel({ gitStatus: { ...gitStatus, repositoryMode } })).toBe("");
    },
  );

  it("keeps the commit result visible after a partial push failure", () => {
    const markup = renderPanel({
      gitStatus: cleanGitStatus,
      result: {
        branch: "feat/commit",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        history: {
          branch: "feat/commit",
          commits: [],
          nextCursor: null,
          repositories: [],
          repository: null,
          repositoryMode: "root",
        },
        message: "feat(git): 提交选择文件",
        pushError: "fatal: unable to access remote repository",
        pushStatus: "failed",
        status: cleanGitStatus,
      },
    });

    expect(markup).toContain("0123456");
    expect(markup).toContain('aria-label="重试推送"');
    expect(markup).not.toContain("fatal: unable to access remote repository");
  });
});
