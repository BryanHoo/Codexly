import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { ComposerBranchSwitcher } from "./composer-branch-switcher.js";
import { ComposerApprovalControls } from "./workbench-composer-approval-controls.js";
import {
  ComposerModeTag,
  ComposerFastModeButton,
  ComposerProjectRootControls,
  ComposerProjectPathButton,
  resolveQueuedPromptSummary,
} from "./workbench-composer-view.js";

describe("WorkbenchComposerView", () => {
  it("仅渲染 CLI 对外提供的审批选项", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerApprovalControls
          disabled={false}
          onSettingsChange={() => undefined}
          sandboxModeSelectable
          settings={{
            approvalPolicy: {
              granular: {
                mcp_elicitations: true,
                request_permissions: true,
                rules: true,
                sandbox_approval: true,
                skill_approval: true,
              },
            },
            approvalsReviewer: "user",
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            sandboxMode: "workspace-write",
          }}
        />
      </TooltipProvider>,
    );

    expect(markup).toMatch(/<option value="on-request"[^>]*>按需审批<\/option>/u);
    expect(markup).toContain('<option value="never">从不询问</option>');
    expect(markup).not.toContain('<option value="untrusted">');
    expect(markup).not.toContain('<option value="granular">');
    expect(markup).toContain('<option value="auto-review">自动审核</option>');
    expect(markup).not.toContain('data-approve-for-me=""');
  });

  it("渲染可切换的快速模式按钮", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerFastModeButton disabled={false} enabled onChange={() => undefined} />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="关闭快速模式"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('data-fast-mode=""');
  });

  it("渲染可取消的计划模式标签", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerModeTag disabled={false} mode="plan" onRemove={() => undefined} />
      </TooltipProvider>,
    );

    expect(markup).toContain('data-plan-mode=""');
    expect(markup).toContain('aria-label="取消计划模式"');
    expect(markup).toContain("计划");
  });

  it("渲染可取消的 Goal 模式标签", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerModeTag disabled={false} mode="goal" onRemove={() => undefined} />
      </TooltipProvider>,
    );

    expect(markup).toContain('data-goal-mode=""');
    expect(markup).toContain('aria-label="取消目标模式"');
    expect(markup).toContain("目标");
    expect(markup).toContain("group-hover/composer-mode:opacity-100");
  });

  it("优先展示队列文本、Skill 和附件摘要", () => {
    const basePrompt = { files: [], id: "queue-1", skills: [], status: "queued" } as const;

    expect(resolveQueuedPromptSummary({ ...basePrompt, text: "继续修复" }, "1 个附件")).toBe(
      "继续修复",
    );
    expect(
      resolveQueuedPromptSummary(
        {
          ...basePrompt,
          skills: [
            {
              description: "检查代码",
              displayName: "Review",
              id: "review",
              name: "review",
              scope: "system",
            },
          ],
          text: "",
        },
        "1 个附件",
      ),
    ).toBe("$review");
    expect(resolveQueuedPromptSummary({ ...basePrompt, text: "" }, "1 个附件")).toBe("1 个附件");
  });

  it("将根仓库当前分支渲染为可访问的切换触发器", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerBranchSwitcher
          creatingBranch={undefined}
          creatingWorktree={undefined}
          gitStatus={{
            baseBranches: ["origin/main", "main"],
            branch: "feat/review",
            branches: ["feat/review", "main"],
            repositoryMode: "root",
            snapshot: "a".repeat(64),
            staged: [],
            unstaged: [],
          }}
          onBranchChange={() => undefined}
          onBranchCreate={() => Promise.resolve(true)}
          onWorktreeChange={() => undefined}
          onWorktreeCreate={() => Promise.resolve(true)}
          switchingBranch={undefined}
          switchingWorktree={undefined}
          worktrees={[]}
          worktreesError={null}
          worktreesPending={false}
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('aria-label="切换分支，当前分支 feat/review"');
    expect(markup).toContain("feat/review");
  });

  it("聚合仓库模式只展示分支状态，不提供切换按钮", () => {
    const markup = renderToStaticMarkup(
      <ComposerBranchSwitcher
        creatingBranch={undefined}
        creatingWorktree={undefined}
        gitStatus={{
          baseBranches: [],
          branch: null,
          branches: [],
          repositoryMode: "children",
          snapshot: "a".repeat(64),
          staged: [],
          unstaged: [],
        }}
        onBranchChange={() => undefined}
        onBranchCreate={() => Promise.resolve(true)}
        onWorktreeChange={() => undefined}
        onWorktreeCreate={() => Promise.resolve(true)}
        switchingBranch={undefined}
        switchingWorktree={undefined}
        worktrees={[]}
        worktreesError={null}
        worktreesPending={false}
      />,
    );

    expect(markup).toContain("未检出分支");
    expect(markup).not.toContain("<button");
  });

  it("非 Git 项目不展示分支状态", () => {
    const markup = renderToStaticMarkup(
      <ComposerBranchSwitcher
        creatingBranch={undefined}
        creatingWorktree={undefined}
        gitStatus={{
          baseBranches: [],
          branch: null,
          branches: [],
          repositoryMode: "none",
          snapshot: "a".repeat(64),
          staged: [],
          unstaged: [],
        }}
        onBranchChange={() => undefined}
        onBranchCreate={() => Promise.resolve(true)}
        onWorktreeChange={() => undefined}
        onWorktreeCreate={() => Promise.resolve(true)}
        switchingBranch={undefined}
        switchingWorktree={undefined}
        worktrees={[]}
        worktreesError={null}
        worktreesPending={false}
      />,
    );

    expect(markup).toBe("");
  });

  it("将项目路径渲染为带 Tooltip 的文件夹打开按钮", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerProjectPathButton
          disabled={false}
          onOpen={() => undefined}
          projectPath="/workspace/CodeAgent"
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('data-slot="tooltip-trigger"');
    expect(markup).toContain('aria-label="在系统文件夹中打开"');
    expect(markup).toContain('data-variant="ghost"');
    expect(markup).toContain("h-6");
    expect(markup).toContain("w-fit");
    expect(markup).toContain("max-w-full");
    expect(markup).toContain("text-caption");
    expect(markup).toContain("hover:bg-control-hover");
    expect(markup).toContain("size-3");
    expect(markup).toContain("/workspace/CodeAgent");
    expect(markup).not.toContain("flex-1");
    expect(markup).not.toContain('title="/workspace/CodeAgent"');
  });

  it("将主目录切换器与项目路径放在同一底部控件中", () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ComposerProjectRootControls
          onOpen={() => undefined}
          onRootChange={() => undefined}
          projectPath="/workspace/primary"
          projectPathOpenDisabled={false}
          roots={[
            { id: "root-primary", path: "/workspace/primary" },
            { id: "root-secondary", path: "/workspace/secondary" },
          ]}
          selectedRootId="root-primary"
        />
      </TooltipProvider>,
    );

    expect(markup).toContain('data-composer-project-root-controls=""');
    expect(markup).toContain('aria-label="在系统文件夹中打开"');
    expect(markup).toContain('aria-label="选择项目目录"');
    expect(markup).toContain('data-size="toolbar"');
    expect(markup.indexOf('aria-label="选择项目目录"')).toBeLessThan(
      markup.indexOf('aria-label="在系统文件夹中打开"'),
    );
  });
});
