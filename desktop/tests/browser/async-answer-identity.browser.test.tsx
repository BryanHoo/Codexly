import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { createTaskStore as createWebStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as WebTimeline } from "../../../apps/web/src/features/workbench/components/task-timeline-store.js";
import { createTaskStore as createDesktopStore } from "../../src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as DesktopTimeline } from "../../src/features/workbench/components/task-timeline-store.js";
import { i18n as webI18n } from "../../../apps/web/src/i18n/i18n.js";
import { i18n } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";
import "../../src/shared/styles/workbench.css";

const timestamp = "2026-11-05T01:29:45.000Z";
const text = "连接池容量设为 16 时，你要求的是哪种上限？\n整个服务实例连接所有 Redis 节点，合计最多 16 条";
const answer = { id: "native-answer", type: "message", role: "user", text, identityAliases: ["persisted-answer"] } as const;
const tail = { id: "assistant-reply", type: "message", role: "assistant", text: "明白，单个文件服务实例的全部 Redis 连接合计不超过 16 条。" } as const;
const response = {
  checkpoint: { sequence: 0, sessionId: "session" },
  snapshot: {
    id: "task", projectId: "project", title: "异步问答", pinned: false,
    updatedAt: timestamp, status: "running", pendingRequests: [],
    turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
    settings: { approvalPolicy: "on-request", approvalsReviewer: "user", model: "model", reasoningEffort: "high", sandboxMode: "workspace-write" },
    turns: [{ id: "turn", status: "running", startedAt: timestamp, completedAt: null, error: null, items: [answer, tail] }],
  },
} as const;

for (const platform of ["web", "desktop"] as const) {
  test.each([360, 960])(`${platform} 迟到的旧 ID 回答保持唯一且原位显示 (%s px)`, async (width) => {
    await page.viewport(width, 900);
    await webI18n.changeLanguage("zh-CN");
    await i18n.changeLanguage("zh-CN");
    const props = { connected: true, onOpenFileDiff: () => undefined,
      onOpenSourceFile: () => undefined, onReviewFileChanges: () => undefined,
      onResolvePendingRequest: () => Promise.resolve() };
    // 两端各自挂载真实 Store 与时间线，避免只验证导出快照而遗漏屏幕上的重复气泡。
    const store = platform === "web"
      ? createWebStore({ projectId: "project", taskId: "task" }, response)
      : createDesktopStore({ projectId: "project", taskId: "task" }, response);
    const screen = await render(<TooltipProvider><div style={{ height: 650, width: "100%" }}>
      {platform === "web"
        ? <WebTimeline {...props} store={store as ReturnType<typeof createWebStore>} />
        : <DesktopTimeline {...props} store={store as ReturnType<typeof createDesktopStore>} />}
    </div></TooltipProvider>);
    await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
    for (const [index, type] of (["item.started", "item.completed"] as const).entries()) {
      store.getState().applyEvents([{
        version: 2, provider: "codex", taskId: "task", turnId: "turn", timestamp,
        sessionId: "session", sequence: index + 1, type, itemId: "persisted-answer",
        payload: { item: { ...answer, id: "persisted-answer", identityAliases: [] } },
      }]);
      await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
      const messages = [...document.querySelectorAll('[data-message-text="true"]')];
      const answers = messages.filter((node) => node.textContent === text);
      expect(answers).toHaveLength(1);
      const reply = screen.getByText(tail.text, { exact: true }).element();
      expect(answers[0]!.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
}
