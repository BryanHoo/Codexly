import type { AgentEvent, AgentItem } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { createStore } from "zustand/vanilla";

import { i18n } from "../../../i18n/i18n.js";
import {
  createTaskItemStore,
  type TaskStore,
} from "../../conversation/runtime/task-store.js";
import { TimelineOperationGroupDisclosure } from "./task-timeline-operation-groups.js";
import { StoredAssistantTimelineItems } from "./task-timeline-store-operation-groups.js";
import "../../../shared/styles/globals.css";
import { OperationGroup } from "@codexly/ui/agent/operation-group";
import { Tool, ToolHeader, ToolBody, ToolInput, ToolOutput } from "@codexly/ui/agent/tool";
import { Terminal, TerminalContent } from "@codexly/ui/agent/terminal";

type TimelineOperation = Extract<
  AgentItem,
  { type: "command" } | { type: "file_change" } | { type: "tool" }
>;

describe("TimelineOperationGroupDisclosure", () => {
  it.each([320, 960])("%spx 列表的详情独立于五行窗口，长输出只出现一个纵向滚动区", async (width) => {
    const output = Array.from({ length: 100 }, (_, index) => `运行日志 ${index}`).join("\n");
    const view = (autoOpen: boolean) => (
      <div style={{ width }}>
        <OperationGroup active={false} autoOpen={autoOpen} collapseLabel="收起操作" expandLabel="展开操作"
          runningLabel="运行中" closeLabel="关闭" summary="执行 8 项操作" count={8}>
          {Array.from({ length: 8 }, (_, index) => (
            <Tool key={index} defaultOpen isStreaming>
              <ToolHeader title={`命令 ${index}`} state="output-available" />
              <ToolBody>
                <Terminal output={output}><TerminalContent /></Terminal>
                <ToolInput input={{ command: "pnpm test" }} />
                <ToolOutput errorText={undefined} output={output} />
              </ToolBody>
            </Tool>
          ))}
        </OperationGroup>
      </div>
    );
    const screen = await render(view(true));
    expect(screen.getByRole("dialog").query()).toBeNull();
    const viewport = screen.container.querySelector<HTMLElement>("[data-operation-viewport]")!;
    viewport.scrollTop = 0;
    const height = viewport.clientHeight;
    const command = screen.getByRole("button", { name: /命令 0$/ }).element() as HTMLButtonElement;
    command.click();
    const dialog = screen.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    const panel = dialog.element() as HTMLElement;
    expect(panel.closest("[data-operation-viewport]")).toBeNull();
    expect(panel.getBoundingClientRect().height).toBeGreaterThan(156);
    expect(panel.getBoundingClientRect().width).toBeGreaterThan(width === 320 ? 320 : 600);
    expect(viewport.clientHeight).toBe(height);
    const body = panel.querySelector<HTMLElement>("[data-operation-detail-body]")!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    for (const node of panel.querySelectorAll<HTMLElement>("[data-slot=terminal-content], [data-slot=code-block-content]")) {
      expect(node.scrollHeight - node.clientHeight).toBeLessThanOrEqual(1);
    }
    body.scrollTop = body.scrollHeight;
    expect(body.scrollTop).toBeGreaterThan(0);
    // 后续正文到达也不能在读者查看日志时卸载弹层。
    await screen.rerender(view(false));
    await expect.element(dialog).toBeVisible();
    await screen.getByRole("button", { name: "关闭", exact: true }).click();
    await expect.poll(() => screen.getByRole("dialog").query()).toBeNull();
    await expect.poll(() => document.activeElement === command).toBe(true);
  });

  it.each([320, 960])("%spx 下从第一条显示折叠入口，超过五行仅内部滚动", async (width) => {
    await i18n.changeLanguage("zh-CN");
    const items: AgentItem[] = Array.from({ length: 8 }, (_, index) => ({
      id: `operation-${index}`, type: "command", command: `echo ${index}`,
      cwd: "/workspace", status: "completed", outputOmitted: { bytes: 0, lines: 0 },
    }));
    const itemStoresByKey = new Map(items.map((item) => [item.id, createTaskItemStore(item)]));
    const store = createStore(() => ({ itemStoresByKey })) as unknown as TaskStore;
    const view = (count: number) => (
      <div style={{ width, height: 400, overflow: "auto" }} data-testid="outer-scroll">
        <div style={{ height: 220 }}>之前的文字信息</div>
        <TimelineOperationGroupDisclosure itemKeys={items.slice(0, count).map((item) => item.id)} store={store}>
          {items.slice(0, count).map((item, index) => <div key={item.id} style={{ height: 28 }}>活动 {index}</div>)}
        </TimelineOperationGroupDisclosure>
      </div>
    );
    const screen = await render(view(1));
    const group = screen.container.querySelector<HTMLElement>("[data-operation-group]");
    expect(group).not.toBeNull();
    const trigger = group!.querySelector<HTMLButtonElement>(":scope > button")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    trigger.click();
    await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.click();
    await screen.rerender(view(6));
    const viewport = screen.container.querySelector<HTMLElement>("[data-operation-viewport]")!;
    await expect.poll(() => viewport?.clientHeight).toBeGreaterThan(0);
    expect(viewport.clientHeight).toBeLessThanOrEqual(156);
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    await Promise.all(group!.getAnimations({ subtree: true }).map((animation) => animation.finished));
    const outer = screen.getByTestId("outer-scroll").element();
    const height = outer.scrollHeight;
    const top = outer.scrollTop;
    const scrollTo = vi.spyOn(viewport, "scrollTo");
    await screen.rerender(view(8));
    await expect.poll(() => scrollTo.mock.calls.length).toBeGreaterThan(0);
    expect(scrollTo).toHaveBeenCalledWith({ top: viewport.scrollHeight - viewport.clientHeight, behavior: "smooth" });
    scrollTo.mockRestore();
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    expect(outer.scrollHeight).toBe(height);
    expect(outer.scrollTop).toBe(top);
    // 读者自行滚动；上翻后不抢回底部，也不显示额外的返回按钮。
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    viewport.scrollTop = 0;
    await expect.poll(() => viewport.scrollTop).toBe(0);
    await screen.rerender(view(6));
    expect(viewport.scrollTop).toBe(0);
    expect(screen.getByRole("button", { name: "回到底部", exact: true }).query()).toBeNull();
    viewport.scrollTop = viewport.scrollHeight;
    await expect.poll(() => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop).toBeLessThanOrEqual(1);
    expect(outer.scrollTop).toBe(top);
  });

  it.each([320, 960])("查看图片在 %spx 容器中随命令工具收起，展开后仍可打开预览", async (width) => {
    await i18n.changeLanguage("zh-CN");
    const image: AgentItem = { id: "image", type: "activity", label: "查看图片", detail: "/tmp/image.png", status: "completed" };
    const items: AgentItem[] = [
      { id: "command", type: "command", command: "pwd", cwd: "/workspace", status: "failed", outputOmitted: { bytes: 0, lines: 0 } },
      image,
      { id: "tool", type: "tool", name: "test_tool", status: "completed" },
      { id: "reply", type: "message", role: "assistant", text: "" },
    ];
    const itemStoresByKey = new Map(items.map((item) => [item.id, createTaskItemStore(item)]));
    const store = createStore(() => ({ itemStoresByKey })) as unknown as TaskStore;
    const onOpenSourceFile = vi.fn();
    const screen = await render(
      <div style={{ width }}>
        <span className="text-muted-foreground" data-testid="neutral-color">默认灰色</span>
        <StoredAssistantTimelineItems
          itemKeys={items.map((item) => item.id)}
          lastTurnItemKey="reply"
          onOpenFileDiff={() => {}}
          onOpenSourceFile={onOpenSourceFile}
          projectId="project"
          taskId="task"
          store={store}
          turnStatus="running"
        />
      </div>,
    );
    await expect.element(screen.getByText("查看图片", { exact: true })).toBeVisible();
    // 后续回复流式到达后应仅剩一个操作摘要，不能把图片遗留在组外。
    const replyStore = itemStoresByKey.get("reply")!;
    replyStore.appendDelta({
      itemId: "reply", payload: { delta: "检查完成。" }, provider: "codex", receivedAtUnixMs: 1,
      sequence: 1, sessionId: "session", taskId: "task", timestamp: "2026-10-28T00:00:00.000Z",
      turnId: "turn", type: "message.delta", version: 2,
    });
    replyStore.publish();
    const summaryText = screen.getByText("操作完成：调用 2 个工具，执行 1 条命令；其中 1 项失败", { exact: true });
    await expect.element(summaryText).toBeVisible();
    await expect.poll(() => screen.getByText("查看图片", { exact: true }).query()).toBeNull();
    const summaryButton = summaryText.element().closest("button")!;
    expect(summaryButton.getAttribute("aria-expanded")).toBe("false");
    // 聚合摘要及其图标保持默认灰色，不能继承组内失败条目的危险色。
    const neutralColor = getComputedStyle(screen.getByTestId("neutral-color").element()).color;
    expect(getComputedStyle(summaryText.element()).color).toBe(neutralColor);
    expect(getComputedStyle(summaryButton.querySelector("[data-slot=trace-status-icon]")!).color).toBe(neutralColor);
    summaryButton.click();
    await expect.element(screen.getByText("查看图片", { exact: true })).toBeVisible();
    const failedCommand = screen.getByText("pwd", { exact: true }).element();
    expect(failedCommand.closest("[data-slot=trace-line]")!.getAttribute("data-status")).toBe("error");
    screen.getByText("查看图片", { exact: true }).element().closest("button")!.click();
    await screen.getByRole("button", { name: "/tmp/image.png", exact: true }).click();
    expect(onOpenSourceFile).toHaveBeenCalledExactlyOnceWith({ path: "/tmp/image.png", lineNumber: null });
  });

  it("collapses completed operations after following assistant text starts streaming", async () => {
    await i18n.changeLanguage("zh-CN");
    const operationItems: TimelineOperation[] = [
      {
        command: "pnpm test",
        cwd: "/workspace",
        id: "command-1",
        outputOmitted: { bytes: 0, lines: 0 },
        status: "completed",
        type: "command",
      },
      {
        id: "mcp-tool-1",
        name: "mcp__fast_context__fast_context_search",
        status: "completed",
        type: "tool",
      },
      {
        changes: [
          { diff: "--- /dev/null\n+++ b/src/created.ts\n@@ -0,0 +1,1 @@\n+created\n", kind: "create", path: "src/created.ts", stats: { additions: 1, removals: 0 } },
          { diff: "--- a/src/updated.ts\n+++ b/src/updated.ts\n@@ -1,1 +1,1 @@\n-before\n+after\n", kind: "update", path: "src/updated.ts", stats: { additions: 1, removals: 1 } },
          { diff: "--- a/src/deleted.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-deleted\n", kind: "delete", path: "src/deleted.ts", stats: { additions: 0, removals: 1 } },
        ],
        id: "file-change-1",
        status: "completed",
        type: "file_change",
      },
    ];
    const followingMessage = {
      id: "assistant-1",
      role: "assistant",
      text: "",
      type: "message",
    } as const satisfies AgentItem;
    const itemStoresByKey = new Map(
      [...operationItems, followingMessage].map(
        (item) => [item.id, createTaskItemStore(item)] as const,
      ),
    );
    const store = {
      getState: () => ({ itemStoresByKey }),
    } as unknown as TaskStore;
    const screen = await render(
      <TimelineOperationGroupDisclosure
        collapseAfterItemKey={followingMessage.id}
        itemKeys={operationItems.map((item) => item.id)}
        store={store}
      >
        <div>原始操作列表</div>
      </TimelineOperationGroupDisclosure>,
    );

    await expect.element(screen.getByText("原始操作列表")).toBeVisible();
    expect(screen.getByText("操作完成：变更 3 个文件，调用 1 个工具，执行 1 条命令").element().closest("button")?.getAttribute("aria-expanded")).toBe("true");

    // Delta 先进入延迟物化缓冲区，折叠触发必须读取完整文本而非初始空实体。
    const messageDelta = {
      itemId: followingMessage.id,
      payload: { delta: "继续处理" },
      provider: "codex",
      receivedAtUnixMs: 1,
      sequence: 1,
      sessionId: "session-1",
      taskId: "task-1",
      timestamp: "2026-09-03T00:00:00.000Z",
      turnId: "turn-1",
      type: "message.delta",
      version: 2,
    } as const satisfies Extract<AgentEvent, { type: "message.delta" }>;
    const followingMessageStore = itemStoresByKey.get(followingMessage.id);
    expect(followingMessageStore?.appendDelta(messageDelta)).toBe(true);
    followingMessageStore?.publish();

    const summaryText = screen.getByText(
      "操作完成：变更 3 个文件，调用 1 个工具，执行 1 条命令",
    );
    await vi.waitFor(() => {
      expect(summaryText.query()).not.toBeNull();
    });
    expect(summaryText.query()?.closest("button")?.getAttribute("aria-expanded")).toBe("false");
    await expect.poll(() => screen.getByText("原始操作列表").query()).toBeNull();
  });
});
