import { useState, type ComponentProps } from "react";
import { GitRemoteStatus } from "@codexly/ui/core/git-remote-status";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { PushProjectCommitsRequest } from "@codexly/protocol";
import { CommitChangesPanel } from "./commit-changes-panel.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { i18n } from "../../../i18n/i18n.js";
import "../../../shared/styles/globals.css";

type RemoteRequest = Omit<PushProjectCommitsRequest, "expectedSnapshot">;

const remoteState = {
  head: "b".repeat(40),
  upstream: "origin/feature/git",
  remote: "origin",
  targetBranch: "feature/git",
  remotes: [{ name: "origin", url: "https://github.com/example/repo.git" }],
  ahead: 1,
  behind: 0,
  checkedAt: "2026-10-14T00:00:00Z",
  operation: "none" as const,
  conflicts: [],
};

function Workspace({ operate, generate = () => Promise.resolve("") }: Readonly<{
  operate: (request: RemoteRequest) => Promise<void>;
  generate?: () => Promise<string>;
}>) {
  const [activeAction, setActiveAction] = useState<RemoteRequest["action"] | null>(null);
  return (
    <div style={{ height: 600, width: 420 }}><TooltipProvider>
      <CommitChangesPanel
        draftScope="git-actions-test"
        gitStatus={{
          branch: "feature/git", branches: [], baseBranches: [], repositoryMode: "root",
          snapshot: "a".repeat(64), staged: [],
          unstaged: [{ path: "file.ts", kind: "update", diff: "", stats: { additions: 0, removals: 0 } }],
        }}
        remoteResult={{ branch: "feature/git", pushStatus: "checked", pushError: null, remoteState }}
        isPushing={activeAction !== null}
        activeRemoteAction={activeAction}
        onRemoteAction={async (request) => {
          setActiveAction(request.action);
          try { await operate(request); } finally { setActiveAction(null); }
        }}
        onCommit={vi.fn().mockResolvedValue(undefined)}
        onGenerateMessage={generate}
        onPush={vi.fn().mockResolvedValue(undefined)}
        onOpenFileDiff={vi.fn()}
      />
    </TooltipProvider></div>
  );
}

it("远端配置在弹窗编辑，失败保留表单，成功关闭并恢复入口焦点", async () => {
  await i18n.changeLanguage("zh-CN");
  const operate = vi.fn().mockRejectedValueOnce(new Error("配置保存失败")).mockResolvedValue(undefined);
  const screen = await render(<Workspace operate={operate} />);
  await screen.getByRole("button", { name: "更多远端操作", exact: true }).click();
  await screen.getByRole("menuitem", { name: "配置远端", exact: true }).click();
  await expect.element(screen.getByRole("dialog", { name: "配置远端" })).toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "远端地址" })).toHaveValue(remoteState.remotes[0]?.url);
  expect(document.querySelector('[data-slot="git-remote-status"] > form')).toBeNull();
  await screen.getByRole("textbox", { name: "远端地址" }).fill("https://github.com/example/updated.git");
  await screen.getByRole("button", { name: "保存远端", exact: true }).click();
  await expect.element(screen.getByRole("dialog").getByText("未能保存远端配置，请检查名称和地址后重试。")).toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "远端地址" })).toHaveValue("https://github.com/example/updated.git");
  await screen.getByRole("button", { name: "保存远端", exact: true }).click();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(operate).toHaveBeenLastCalledWith({ action: "configure", remote: "origin", url: "https://github.com/example/updated.git" });
  await expect.element(screen.getByRole("button", { name: "更多远端操作", exact: true })).toHaveFocus();
});

it("AI 生成直接覆盖已填写信息，无需确认，并可撤销", async () => {
  await i18n.changeLanguage("zh-CN");
  const generated = "feat(git): 生成提交信息\n\n完整的多行信息";
  const screen = await render(
    <Workspace operate={vi.fn().mockResolvedValue(undefined)} generate={() => Promise.resolve(generated)} />,
  );
  const message = screen.getByRole("textbox", { name: "提交信息", exact: true });
  await message.fill("原有手写提交信息");
  await screen.getByRole("button", { name: "AI 生成", exact: true }).click();
  await expect.element(message).toHaveValue(generated);
  expect(document.querySelector('[data-slot="git-commit-footer"]')?.textContent).not.toMatch(/采用建议|保留原文/u);
  await screen.getByRole("button", { name: "撤销生成", exact: true }).click();
  await expect.element(message).toHaveValue("原有手写提交信息");
});

it("底部菜单只保留提交并推送，获取更新时准确显示进度", async () => {
  await i18n.changeLanguage("zh-CN");
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const screen = await render(<Workspace operate={() => pending} />);
  await screen.getByRole("button", { name: "更多 Git 操作" }).click();
  await expect.element(screen.getByRole("menuitem", { name: /提交并推送/u })).toBeVisible();
  expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
  // 关闭菜单后再获取，验证顶部和底部不会错误地显示推送或 AI 生成状态。
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await expect.element(screen.getByRole("menu")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "获取远端更新", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "获取更新中…", exact: true })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "提交", exact: true })).toBeDisabled();
  expect(document.querySelector('[data-slot="git-commit-footer"]')?.textContent).not.toContain("生成中");
  finish();
  await expect.element(screen.getByRole("button", { name: "推送", exact: true })).toBeEnabled();
});


it("顶部在不同语言、提示和同步状态之间保持固定高度", async () => {
  type Props = ComponentProps<typeof GitRemoteStatus>;
  const states: Partial<Props>[] = [
    {},
    { remote: { ...remoteState, ahead: 0 } },
    { remote: { ...remoteState, remotes: [], upstream: null } },
    { remote: { ...remoteState, upstream: null } },
    { remote: { ...remoteState, behind: 1 } },
    { remote: { ...remoteState, ahead: 0, behind: 1 }, hasWorkingChanges: true },
    { remote: { ...remoteState, operation: "merge", conflicts: ["file.ts"] } },
    { branch: "feature/".repeat(25), remote: { ...remoteState, targetBranch: "long/".repeat(25) } },
    { pushStatus: "failed", pushError: "Git status changed before the push" },
    { pushStatus: "failed", pushError: "Could not resolve host: example.com" },
    { pushStatus: "failed", savedFailureKind: "protected_branch" },
    { busy: true, activeAction: "fetch" },
  ];
  const toolbar = (props: Partial<Props>) => (
    <div style={{ width: 320 }}>
      <TooltipProvider>
        <GitRemoteStatus
          branch="feature/git" remote={remoteState} pushStatus="checked" pushError={null}
          busy={false} activeAction={null} actionError={null} inspecting={false}
          onPush={() => undefined} onAction={() => Promise.resolve(true)}
          onOpenHistory={() => undefined} t={(key, values) => i18n.t(key, { ...values, ns: "workbench" })}
          {...props}
        />
      </TooltipProvider>
    </div>
  );
  const screen = await render(toolbar({}));
  for (const language of ["zh-CN", "en"]) {
    await i18n.changeLanguage(language);
    for (const props of states) {
      await screen.rerender(toolbar(props));
      // 测量真实布局，验证长分支、长提示、双向计数及获取进度不会挤动文件审查区。
      const element = document.querySelector<HTMLElement>('[data-slot="git-remote-status"]');
      if (!element) throw new Error("Missing Git remote toolbar");
      expect(element.getBoundingClientRect().height).toBe(72);
      const primary = element.querySelector<HTMLElement>('[data-slot="git-remote-primary"]');
      const row = element.querySelector<HTMLElement>('[data-slot="git-remote-summary"]');
      expect(row?.contains(primary ?? null)).toBe(true);
      expect(primary?.getBoundingClientRect().height).toBe(24);
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
    }
  }
  await i18n.changeLanguage("zh-CN");
});
