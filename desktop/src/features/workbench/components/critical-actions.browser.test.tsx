import type { PendingRequest, ProjectGitStatus } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nextProvider, i18n } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { CommitChangesPanel } from "./commit-changes-panel.js";
import { PendingRequestCard } from "./pending-request.js";
import { PermissionApprovalRequestCard } from "./permission-approval-request.js";

const permissionRequest = {
  createdAt: "2026-08-30T01:00:00.000Z",
  cwd: "/workspace/CodeAgent",
  environmentId: "local",
  expiresAt: null,
  itemId: "permission-item-1",
  permissions: {
    fileSystem: {
      entries: [],
      globScanMaxDepth: null,
      read: ["/workspace/CodeAgent"],
      write: ["/workspace/CodeAgent/src"],
    },
    network: { enabled: true },
  },
  projectId: "codeagent",
  reason: "运行集成测试",
  requestId: "approval-1",
  status: "pending",
  taskId: "task-1",
  turnId: "turn-1",
  type: "permissions_approval",
} as const satisfies PendingRequest;

const gitStatus = {
  baseBranches: ["main"],
  branch: "test/ui",
  branches: ["test/ui", "main"],
  repositoryMode: "root",
  snapshot: "a".repeat(64),
  staged: [],
  unstaged: [
    { diff: "--- a/src/provider.ts\n+++ b/src/provider.ts\n@@ -0,0 +1,1 @@\n+provider\n", kind: "update", path: "src/provider.ts", stats: { additions: 1, removals: 0 } },
    { diff: "--- /dev/null\n+++ b/src/queue.ts\n@@ -0,0 +1,1 @@\n+queue\n", kind: "create", path: "src/queue.ts", stats: { additions: 1, removals: 0 } },
  ],
} as const satisfies ProjectGitStatus;

const terminalInputRequest = {
  approvalId: "approval-stdin-a",
  availableDecisions: ["allow", "deny"],
  createdAt: "2026-08-31T08:00:00.000Z",
  cwd: "/workspace/CodeAgent",
  expiresAt: null,
  itemId: "command-a",
  processId: "42",
  projectId: "codeagent",
  reason: "命令正在等待输入",
  requestId: "approval-stdin-a",
  status: "pending",
  stdin: "yes\n",
  taskId: "task-1",
  turnId: "turn-1",
  type: "terminal_input_approval",
} as const satisfies PendingRequest;

function TestProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{children}</TooltipProvider>
    </I18nextProvider>
  );
}

describe("关键操作组件", () => {
  it("展示终端输入上下文并提交审批决定", async () => {
    await i18n.changeLanguage("zh-CN");
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TestProviders>
        <PendingRequestCard interactive onResolve={onResolve} request={terminalInputRequest} />
      </TestProviders>,
    );

    await expect.element(screen.getByText("终端输入审批")).toBeVisible();
    await expect.element(screen.getByText("会话 42")).toBeVisible();
    await expect.element(screen.getByText("/workspace/CodeAgent")).toBeVisible();
    await expect.element(screen.getByText("yes")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "允许" })).toHaveFocus();
    await screen.getByRole("button", { name: "拒绝" }).click();

    expect(onResolve).toHaveBeenCalledOnce();
    expect(onResolve.mock.calls[0]?.[1]).toEqual({ decision: "deny" });
  });

  it("默认聚焦批准操作并提交用户选择的权限范围", async () => {
    await i18n.changeLanguage("zh-CN");
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TestProviders>
        <PermissionApprovalRequestCard
          interactive
          onResolve={onResolve}
          request={permissionRequest}
        />
      </TestProviders>,
    );
    const allowTurn = screen.getByRole("button", { name: "本轮允许" });

    await expect.element(allowTurn).toHaveFocus();
    await screen.getByRole("checkbox", { name: "网络访问" }).click();
    await allowTurn.click();

    expect(onResolve).toHaveBeenCalledOnce();
    expect(onResolve.mock.calls[0]?.[1]).toEqual({
      grantedPermissions: ["file_system"],
      scope: "turn",
    });
  });

  it("通过真实表单提交所选 Git 文件和提交信息", async () => {
    await i18n.changeLanguage("zh-CN");
    const onCommit = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <TestProviders>
        <CommitChangesPanel
          gitStatus={gitStatus}
          onCommit={onCommit}
          onGenerateMessage={vi.fn().mockResolvedValue("test(git): 生成提交")}
          onOpenFileDiff={() => undefined}
        />
      </TestProviders>,
    );

    await screen.getByRole("textbox", { name: "提交信息" }).fill("test(git): 覆盖真实交互");
    await screen.getByRole("button", { name: "提交", exact: true }).click();

    expect(onCommit).toHaveBeenCalledWith({
      action: "commit",
      expectedSnapshot: "a".repeat(64),
      message: "test(git): 覆盖真实交互",
      paths: ["src/provider.ts", "src/queue.ts"],
    });
  });
});
