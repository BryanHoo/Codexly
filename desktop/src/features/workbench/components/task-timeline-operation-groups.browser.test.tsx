import type { AgentEvent, AgentItem } from "@/protocol/index.js";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { i18n } from "../../../i18n/i18n.js";
import {
  createTaskItemStore,
  type TaskStore,
} from "../../conversation/runtime/task-store.js";
import { TimelineOperationGroupDisclosure } from "./task-timeline-operation-groups.js";

type TimelineOperation = Extract<
  AgentItem,
  { type: "command" } | { type: "file_change" } | { type: "tool" }
>;

describe("TimelineOperationGroupDisclosure", () => {
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
    expect(
      screen.getByText("操作完成：变更 3 个文件，调用 1 个工具，执行 1 条命令").query(),
    ).toBeNull();

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
    expect(summaryText.query()?.closest("summary")?.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("原始操作列表").query()).toBeNull();
  });
});
