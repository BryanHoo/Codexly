import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MessageEditProvider, MessageEditAction } from "@codexly/ui/core/message-edit";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { WorkbenchComposerBase as WebComposer } from "../../../apps/web/src/features/workbench/components/workbench-composer-base.js";
import { WorkbenchComposerBase as DesktopComposer } from "../../src/features/workbench/components/workbench-composer-base.js";
import type { WorkbenchComposerHandle, WorkbenchComposerProps } from "../../../apps/web/src/features/workbench/components/workbench-composer-contracts.js";
import { ComposerDraftProvider as WebDrafts } from "../../../apps/web/src/features/workbench/composer-draft-context.js";
import { ComposerDraftProvider as DesktopDrafts } from "../../src/features/workbench/composer-draft-context.js";
import { ProjectTodoProvider } from "../../../apps/web/src/features/workbench/project-todo-context.js";
import { ProjectDraftProvider } from "../../src/features/workbench/project-draft-context.js";
import { TaskSnapshotTimeline as WebTimeline } from "../../../apps/web/src/features/workbench/components/task-timeline.js";
import { TaskSnapshotTimeline as DesktopTimeline } from "../../src/features/workbench/components/task-timeline.js";
import { i18n as webI18n } from "../../../apps/web/src/i18n/i18n.js";
import { i18n } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";
import "../../src/shared/styles/workbench.css";

vi.mock("../../../apps/web/src/features/access/access-context.js", async (importOriginal) => ({
  ...await importOriginal(),
  useAccess: () => ({ status: { role: "owner" } }),
}));

import { conversation as webConversation } from "../../../apps/web/src/i18n/locales/zh-CN/conversation.js";
import { conversation as desktopConversation } from "../../src/i18n/locales/zh-CN/conversation.js";

const settings = { model: "model", reasoningEffort: "high", approvalPolicy: "on-request", approvalsReviewer: "user", sandboxMode: "workspace-write" } as const;
const original = { id: "user-original", type: "message", role: "user", text: "旧消息第一行\n第二行" } as const;
const snapshot = {
  id: "task", projectId: "project", title: "任务", pinned: false,
  updatedAt: "2026-11-02T00:00:00Z", status: "idle", pendingRequests: [],
  turnsNextCursor: null, contextUsage: null, goal: null, plan: null, settings,
  turns: [{ id: "turn-old", status: "completed", startedAt: "2026-11-02T00:00:00Z",
    completedAt: "2026-11-02T00:00:01Z", error: null,
    items: [original, { id: "answer", type: "message", role: "assistant", text: "旧回复" }] }],
} as const;

for (const platform of ["web", "desktop"] as const) {
  test.each([360, 960])(`${platform}：编辑回填、聚焦并使用新输入提交，保留历史 (%s)`, async (width) => {
    await page.viewport(width, 900);
    await webI18n.changeLanguage("zh-CN");
    await i18n.changeLanguage("zh-CN");
    i18n.addResourceBundle("zh-CN", "conversation", platform === "web" ? webConversation : desktopConversation, true, true);
    const ref = createRef<WorkbenchComposerHandle>();
    const capture = vi.fn(async () => undefined);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props: WorkbenchComposerProps = {
      composerRef: ref, capabilities: undefined, client: {} as WorkbenchComposerProps["client"],
      fastModeAvailable: false, fastModeDefault: false, followUpBehavior: "queue",
      initialDraft: { content: [{ type: "text", text: "当前草稿" }], attachments: [] },
      models: [{ id: "model", displayName: "Model", description: "", isDefault: true,
        inputModalities: ["text"], defaultReasoningEffort: "high", supportedReasoningEfforts: [{ id: "high", description: "" }] }],
      modelsError: null, modelsPending: false, onCaptureSubmission: capture,
      onSettingsChange: vi.fn(), onFastModeChange: vi.fn(), onRequestNotificationPermission: vi.fn(),
      onOpenProjectPath: vi.fn(), onProjectRootChange: vi.fn(), onTaskStarted: vi.fn(),
      projectId: "project", projectPath: "/work", projectToolsEnabled: false,
      projectPathOpenDisabled: false, projectRoots: [], selectedProjectRootId: "", settings, skills: [], taskId: "task",
    };
    const content = <MessageEditProvider onEdit={(message) => ref.current?.editMessage(message)}>
      <div style={{ height: 300 }}>
        {platform === "web" ? <WebTimeline snapshot={snapshot} /> : <DesktopTimeline snapshot={snapshot} />}
      </div>
      {platform === "web" ? <WebComposer {...props} /> : <DesktopComposer {...props} />}
    </MessageEditProvider>;
    const screen = await render(<QueryClientProvider client={queryClient}><TooltipProvider>
      {platform === "web" ? <ProjectTodoProvider><WebDrafts>{content}</WebDrafts></ProjectTodoProvider>
        : <ProjectDraftProvider><DesktopDrafts>{content}</DesktopDrafts></ProjectDraftProvider>}
    </TooltipProvider></QueryClientProvider>);
    const edit = screen.getByRole("button", { name: "编辑为新消息", exact: true });
    await expect.element(edit).toBeVisible();
    expect(edit.all()).toHaveLength(1);
    // 复制与编辑共用工具栏，编辑只出现在用户正文，不出现在助手回复。
    expect(edit.element().previousElementSibling?.getAttribute("aria-label")).toMatch(/复制/);
    await edit.click();
    const editor = screen.getByRole("textbox");
    await expect.element(editor).toHaveValue(original.text);
    await expect.element(editor).toHaveFocus();
    expect(capture).not.toHaveBeenCalled();
    await editor.fill("修改后作为新消息");
    await expect(ref.current!.submitCurrent()).resolves.toBe(true);
    expect(capture.mock.calls[0]?.[0]).toMatchObject({ text: "修改后作为新消息", type: "prompt" });
    await expect.element(screen.getByText(original.text)).toBeVisible();
    expect(snapshot.turns[0].items[0]).toBe(original);
    expect(original.text).toBe("旧消息第一行\n第二行");
    await edit.click();
    await expect.element(editor).toHaveValue(original.text);
    await screen.unmount();
    queryClient.clear();
  });
}

test("只读入口隐藏编辑，分屏动作仅交给所属会话", async () => {
  const first = vi.fn();
  const second = vi.fn();
  const screen = await render(<TooltipProvider>
    <MessageEditAction message={original} label="只读编辑" />
    <MessageEditProvider onEdit={first}><MessageEditAction message={original} label="编辑第一屏" /></MessageEditProvider>
    <MessageEditProvider onEdit={second}><MessageEditAction message={original} label="编辑第二屏" /></MessageEditProvider>
    <MessageEditProvider onEdit={null}><MessageEditAction message={original} label="锁定编辑" /></MessageEditProvider>
  </TooltipProvider>);
  await expect.element(screen.getByRole("button", { name: "只读编辑" })).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button", { name: "锁定编辑" })).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "编辑第二屏" }).click();
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledExactlyOnceWith(original);
});
