import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import {
  CommitChangesPanel,
  collectCommitFileEntries,
  collectCommitRepositories,
} from "./commit-changes-panel.js";
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

function renderPanel(overrides: Partial<ComponentProps<typeof CommitChangesPanel>> = {}): string {
  return renderToStaticMarkup(
    <TooltipProvider>
      <CommitChangesPanel
        gitStatus={gitStatus}
        onCommit={() => Promise.resolve()}
        onGenerateMessage={() => Promise.resolve("feat(git): 生成提交信息")}
        onOpenFileDiff={() => undefined}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe("CommitChangesPanel", () => {
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
    expect(markup).toContain(">提交</button>");
    expect(markup).toContain('aria-label="选择提交方式"');
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
    expect(markup).not.toContain('data-ai-file-tree=""');
  });

  it("requires a selected child repository before showing commit controls", () => {
    const childGitStatus = {
      ...gitStatus,
      repositoryMode: "children" as const,
      staged: [{ diff: "+staged", kind: "update" as const, path: "backend/src/server.ts" }],
      unstaged: [{ diff: "+unstaged", kind: "update" as const, path: "frontend/src/app.ts" }],
    };

    expect(collectCommitRepositories(childGitStatus)).toEqual(["backend", "frontend"]);
    const markup = renderPanel({
      gitStatus: childGitStatus,
      onSelectRepository: () => undefined,
      repositories: ["backend", "frontend"],
      selectedRepository: null,
    });

    expect(markup).toContain("选择 Git 项目");
    expect(markup).not.toContain('id="commit-message"');
  });

  it("keeps the commit result visible after a partial push failure", () => {
    const markup = renderPanel({
      result: {
        branch: "feat/commit",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        message: "feat(git): 提交选择文件",
        pushError: "fatal: unable to access remote repository",
        pushStatus: "failed",
      },
    });

    expect(markup).toContain("0123456");
    expect(markup).not.toContain("fatal: unable to access remote repository");
  });
});
