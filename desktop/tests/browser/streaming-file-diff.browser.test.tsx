import { PatchDiffViewer as SharedPatchDiffViewer } from "@codexly/ui/agent/patch-diff-viewer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { ConversationDisplaySwitch } from "@codexly/ui/core/conversation-display-preferences";
import { createTaskStore as createWebStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as WebTimeline } from "../../../apps/web/src/features/workbench/components/task-timeline-store.js";
import { conversationDisplayPreferences as webPreferences } from "../../../apps/web/src/features/settings/conversation-display-preferences.js";
import { createTaskStore as createDesktopStore } from "../../src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as DesktopTimeline } from "../../src/features/workbench/components/task-timeline-store.js";
import { conversationDisplayPreferences as desktopPreferences } from "../../src/features/settings/conversation-display-preferences.js";
import { i18n } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";

const time = "2026-11-05T00:00:00Z";
const diff = "--- a/profile.js\n+++ b/profile.js\n@@ -19 +19 @@\n-oldValue\n+newValue\n@@ -91 +91 @@\n-oldTail\n+newTail";
const change = { path: "/Users/bryanhu/Develop/person/FeedFuse/src/features/reader/components/src/profile.js", kind: "update" as const, diff, stats: { additions: 1, removals: 1 } };
const file = { id: "file", type: "file_change" as const, status: "running" as const, changes: [change] };
function response(completed = false) {
  return { checkpoint: { sessionId: "session", sequence: 0 }, snapshot: {
    id: "task", projectId: "project", title: "Task", pinned: false, status: completed ? "completed" as const : "running" as const,
    updatedAt: time, pendingRequests: [], turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
    settings: { approvalPolicy: "on-request" as const, approvalsReviewer: "user" as const, model: "model", reasoningEffort: "high" as const, sandboxMode: "workspace-write" as const },
    turns: [{ id: "turn", status: completed ? "completed" as const : "running" as const, startedAt: time, completedAt: completed ? time : null, error: null,
      items: [{ id: "user", type: "message" as const, role: "user" as const, text: "修改文件" }, { ...file, status: completed ? "completed" as const : "running" as const }] }],
  } };
}
const actions = { onOpenFileDiff: vi.fn(), onOpenSourceFile: vi.fn(), onReviewFileChanges: vi.fn(), onResolvePendingRequest: async () => undefined };
const platforms = [
  { name: "web", preferences: webPreferences, create(completed = false) { const store = createWebStore({ projectId: "project", taskId: "task" }, response(completed)); return { store, element: <WebTimeline connected store={store} {...actions} /> }; } },
  { name: "desktop", preferences: desktopPreferences, create(completed = false) { const store = createDesktopStore({ projectId: "project", taskId: "task" }, response(completed)); return { store, element: <DesktopTimeline connected store={store} {...actions} /> }; } },
];
afterEach(() => { delete document.documentElement.dataset.theme; webPreferences.set("independentFileDiffs", false); desktopPreferences.set("independentFileDiffs", false); });
it("完整差异预览保留默认的分隔行密度", async () => {
  const screen = await render(<SharedPatchDiffViewer path="profile.js" patch={diff} preloadLanguage />);
  const root = () => document.querySelector('.file-diff-renderer')?.shadowRoot;
  await expect.poll(() => root()?.querySelectorAll('[data-separator="line-info-basic"]').length ?? 0, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
  expect(root()!.querySelector('[data-separator="line-info-basic"]')!.getBoundingClientRect().height).toBe(32);
  expect(parseFloat(getComputedStyle(root()!.querySelector('[data-code]')!).paddingTop)).toBeGreaterThan(0);
  await screen.unmount();
});
for (const platform of platforms) describe(`${platform.name} 文件差异`, () => {
  it("历史完成回合默认收起，展开过程后恢复差异", async () => {
    await i18n.changeLanguage("zh-CN");
    platform.preferences.set("independentFileDiffs", true);
    const { store, element } = platform.create(true);
    const screen = await render(<TooltipProvider><div style={{ height: 600 }}>{element}</div></TooltipProvider>);
    expect(document.querySelector('[data-file-diff-card]')).toBeNull();
    await screen.getByRole('button', { name: '展开执行过程', exact: true }).click();
    await expect.poll(() => document.querySelector('[data-file-diff-card]')).not.toBeNull();
    await screen.getByRole('button', { name: '收起执行过程', exact: true }).click();
    await expect.poll(() => document.querySelector('[data-file-diff-card]')).toBeNull();
    expect(store.getState().turnIds).toHaveLength(1);
    await screen.unmount();
  });
  it.each([{ width: 360, theme: "light" }, { width: 1280, theme: "light" }, { width: 360, theme: "dark" }, { width: 1280, theme: "dark" }])("$width px $theme 开关即时生效、差异独立、流式更新且完成后折叠到过程", async ({ width, theme }) => {
    platform.preferences.set("independentFileDiffs", false);
    document.documentElement.dataset.theme = theme;
    await i18n.changeLanguage("zh-CN");
    await page.viewport(width, 900);
    const { store, element } = platform.create();
    const screen = await render(<TooltipProvider><ConversationDisplaySwitch store={platform.preferences} preference="independentFileDiffs" label="独立显示文件差异" /><div style={{ width: "100%", height: 600 }}>{element}</div></TooltipProvider>);
    expect(document.querySelector('[data-file-diff-card]')).toBeNull();
    await screen.getByRole("switch", { name: "独立显示文件差异" }).click();
    const card = () => document.querySelector<HTMLElement>('[data-file-diff-card]');
    await expect.poll(() => card()?.textContent).toContain("profile.js");
    expect(card()?.closest('[data-operation-group]')).toBeNull();
    // 读取最终 CSS，防止使用未定义的语义类导致圆角和边框退化成浏览器默认值。
    const cardStyle = getComputedStyle(card()!);
    expect(parseFloat(cardStyle.borderTopLeftRadius)).toBeGreaterThanOrEqual(6);
    expect(cardStyle.borderTopColor).not.toBe(cardStyle.color);
    expect(card()!.querySelector('[data-file-diff-name]')?.textContent).toBe('profile.js');
    await expect.poll(() => card()?.querySelector('.file-diff-renderer')?.shadowRoot?.textContent ?? '', { timeout: 10000 }).toContain('newValue');
    expect(getComputedStyle(card()!.querySelector('.file-diff-renderer')!).colorScheme).toBe(theme);
    // 多段补丁的首个与中间未修改行都采用紧凑行高，且正文顶端没有额外留白。
    const shadow = card()!.querySelector('.file-diff-renderer')!.shadowRoot!;
    const separators = [...shadow.querySelectorAll<HTMLElement>('[data-separator="line-info-basic"]')];
    expect(separators.length).toBeGreaterThanOrEqual(2);
    for (const separator of separators) expect(separator.getBoundingClientRect().height).toBeLessThanOrEqual(20);
    const code = shadow.querySelector<HTMLElement>('[data-code]')!;
    expect(getComputedStyle(code).paddingTop).toBe('0px');
    if (width === 360) await page.screenshot({ path: `../../test-results/diff-hunk-${platform.name}-${theme}.png` });
    expect(separators[0]!.getBoundingClientRect().top - card()!.querySelector('[data-file-diff-content]')!.getBoundingClientRect().top).toBeLessThanOrEqual(1);

    const base = { version: 2 as const, provider: "codex", sessionId: "session", taskId: "task", turnId: "turn", timestamp: time };
    const largeDiff = "--- a/profile.js\n+++ b/profile.js\n@@ -1 +1,151 @@\n-oldValue\n+latestValue\n" + Array.from({ length: 150 }, (_, i) => `+const value${i} = ${i};`).join("\n");
    // 真实单条文件事件只更新卡片正文；随后回合完成仍保留同一个文件模块。
    store.getState().applyEvents([{ ...base, sequence: 1, type: "item.completed", itemId: "file", payload: { item: { ...file, status: "completed", changes: [{ ...change, diff: largeDiff, stats: { additions: 151, removals: 1 } }] } } }]);
    await expect.poll(() => card()?.querySelector('.file-diff-renderer')?.shadowRoot?.textContent ?? '', { timeout: 10000 }).toContain('latestValue');
    const content = () => card()?.querySelector<HTMLElement>('[data-file-diff-content]');
    await expect.poll(() => content()?.scrollHeight ?? 0).toBeGreaterThan(320);
    expect(content()!.getBoundingClientRect().height).toBeLessThanOrEqual(160);
    expect(card()!.getBoundingClientRect().height).toBeLessThan(230);
    content()!.scrollTop = 200;
    expect(content()!.scrollTop).toBeGreaterThan(0);
    store.getState().applyEvents([{ ...base, sequence: 2, type: "turn.completed", payload: { turn: { id: "turn", status: "completed", startedAt: time, completedAt: time, error: null, items: [] } } }]);
    await expect.poll(card).toBeNull();
    await screen.getByRole('button', { name: '展开执行过程', exact: true }).click();
    await expect.poll(() => card()?.textContent).toContain('已应用');
    expect(document.querySelectorAll('[data-file-diff-card]')).toHaveLength(1);
    await page.screenshot({ path: `../../test-results/diff-polish-${platform.name}-${theme}-${width}.png` });
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    const trigger = screen.getByRole('button', { name: /src\/profile.js/u });
    await trigger.click();
    expect(card()?.querySelector('[data-file-diff-content]')).toBeNull();
    await trigger.click();
    await expect.poll(() => card()?.querySelector('[data-file-diff-content]')).not.toBeNull();
    await screen.getByRole('button', { name: '打开文件差异', exact: true }).click();
    expect(actions.onOpenFileDiff).toHaveBeenCalled();
    await screen.getByRole("switch", { name: "独立显示文件差异" }).click();
    await expect.poll(card).toBeNull();
    await expect.element(screen.getByText('已编辑 1 个文件', { exact: true })).toBeVisible();
    await screen.unmount();
  });
});
