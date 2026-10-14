import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComponentProps } from "react";
import { gitCommit as gitWorkspaceChinese } from "../../../i18n/locales/zh-CN/git-commit.js";
import { gitCommit as gitWorkspaceEnglish } from "../../../i18n/locales/en/git-commit.js";
import { GitRemoteStatus } from "@codexly/ui/core/git-remote-status";
import { GitRemoteDialog } from "@codexly/ui/core/git-remote-dialog";
import { TooltipProvider } from "@codexly/ui/core/tooltip";

const remote = {
  head: "a".repeat(40),
  upstream: "origin/main",
  remote: "origin",
  targetBranch: "main",
  remotes: [{ name: "origin", url: "https://example.com/repo.git" }],
  ahead: 2,
  behind: 0,
  checkedAt: "2026-10-14T00:00:00Z",
  operation: "none" as const,
  conflicts: [],
};
function render(overrides: Partial<ComponentProps<typeof GitRemoteStatus>> = {}, english = false) {
  const copy: Record<string, string> = english ? gitWorkspaceEnglish : gitWorkspaceChinese;
  return renderToStaticMarkup(
    <TooltipProvider>
      <GitRemoteStatus
        branch="main"
        remote={remote}
        pushStatus="checked"
        pushError={null}
        busy={false}
        activeAction={null}
        actionError={null}
        inspecting={false}
        onPush={() => undefined}
        onAction={() => Promise.resolve(true)}
        onOpenHistory={() => undefined}
        t={(key, values) =>
          (copy[key.replace("commit.", "")] ?? key).replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
            String(values?.[name] ?? ""),
          )
        }
        {...overrides}
      />
    </TooltipProvider>,
  );
}
describe("Git remote toolbar", () => {
  it("reviews the actual current branch destination when publishing", () => {
    const markup = renderToStaticMarkup(
      <GitRemoteDialog
        kind="publish"
        branch="feature/git"
        remote={{ ...remote, targetBranch: "release" }}
        defaultRemote="origin"
        busy={false}
        error={null}
        failure={null}
        returnFocus={null}
        onAction={() => Promise.resolve(true)}
        onClose={() => undefined}
        t={(key) => key}
      />,
    );
    expect(markup).toContain("origin/feature/git");
    expect(markup).not.toContain("origin/release");
  });
  it("keeps counts clickable and moves raw metadata behind the more menu", () => {
    const markup = render({ commitSha: "a".repeat(40) });
    expect(markup).toContain('data-slot="git-remote-more"');
    expect(markup).toContain('data-slot="git-open-unpushed-history"');
    expect(markup).not.toContain("本地状态检查：");
    expect(markup).not.toContain("https://example.com/repo.git");
    expect(markup).not.toContain("aaaaaaa");
  });
  it("offers fetch after synchronization instead of a disabled synchronized button", () => {
    const markup = render({ remote: { ...remote, ahead: 0 } });
    expect(markup).toMatch(
      /<button[^>]*data-slot="git-remote-primary"[^>]*aria-label="获取远端更新"/u,
    );
    expect(markup.match(/已同步/gu)).toHaveLength(1);
  });
  it("keeps fetch progress on fetch and does not rename the push action", () => {
    const markup = render({ busy: true, activeAction: "fetch" });
    expect(markup).toMatch(/<button[^>]*data-slot="git-remote-primary"[^>]*aria-label="推送"/u);
    expect(markup).toContain('aria-label="获取更新中…"');
  });
  it.each([false, true])(
    "shows one recovery notice with a matching primary action (English=%s)",
    (english) => {
      const markup = render(
        { pushStatus: "failed", pushError: "Git status changed before the push" },
        english,
      );
      expect(markup.match(/role="alert"/gu)).toHaveLength(1);
      expect(markup).toContain(`aria-label="${english ? "Refresh status" : "刷新状态"}"`);
      expect(markup).not.toContain("Git status changed before the push");
      expect(markup).not.toContain("<pre");
    },
  );
  it("only provides external-tool guidance during an unfinished merge", () => {
    const markup = render({
      remote: { ...remote, operation: "merge", conflicts: ["src/conflict.ts"] },
      pushStatus: "failed",
      pushError: "merge conflicts",
    });
    expect(markup).toContain('aria-label="刷新状态"');
    expect(markup).toContain("需在外部 Git 工具处理");
    expect(markup).not.toContain("请在外部 Git 工具处理当前合并，然后刷新状态。");
    expect(markup).toContain("查看详情");
    expect(markup).not.toContain("解决冲突");
    expect(markup).not.toContain("src/conflict.ts");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain('role="alert"');
  });
  it("keeps detailed recovery instructions and saved-commit confirmation in the dialog", () => {
    const copy: Record<string, string> = gitWorkspaceChinese;
    const failure = {
      kind: "network" as const,
      remote: true,
      titleKey: "commit.failure_network",
      helpKey: "commit.fix_network",
    };
    const markup = renderToStaticMarkup(
      <GitRemoteDialog
        kind="error"
        branch="main"
        defaultRemote="origin"
        commitSha={"a".repeat(40)}
        busy={false}
        error={null}
        failure={failure}
        returnFocus={null}
        onAction={() => Promise.resolve(true)}
        onClose={() => undefined}
        t={(key) => copy[key.replace("commit.", "")] ?? key}
      />,
    );
    expect(markup).toContain(copy["fix_network"]);
    expect(markup).toContain("提交已保存到本地。");
    const toolbar = render({
      pushStatus: "failed",
      savedFailureKind: "network",
      commitSha: "a".repeat(40),
    });
    expect(toolbar).toContain("查看详情");
    expect(toolbar).not.toContain(copy["fix_network"]);
    expect(toolbar).not.toContain("提交已保存到本地。");
  });
});
