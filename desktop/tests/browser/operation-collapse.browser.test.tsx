import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { createTaskItemStore as webItem, type TaskStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import { createTaskItemStore as nativeItem } from "../../src/features/conversation/runtime/task-store.js";
import { TimelineOperationGroupDisclosure as WebGroup } from "../../../apps/web/src/features/workbench/components/task-timeline-operation-groups.js";
import { TimelineOperationGroupDisclosure as NativeGroup } from "../../src/features/workbench/components/task-timeline-operation-groups.js";
import { resolveCompletedTurnProcessItemIds as webProcess } from "../../../apps/web/src/features/workbench/components/task-timeline-process.js";
import { resolveCompletedTurnProcessItemIds as nativeProcess } from "../../src/features/workbench/components/task-timeline-process.js";
import type { AgentItem } from "@codexly/protocol";
import "../../src/shared/styles/globals.css";

for (const [platform, Group, createItem, process] of [
  ["web", WebGroup, webItem, webProcess],
  ["desktop", NativeGroup, nativeItem, nativeProcess],
] as const) {
  it(`${platform}：流式正文到达后收起工具，完成后折叠无阶段 ACP 过程`, async () => {
    const items: AgentItem[] = [
      { id: "progress", type: "message", role: "assistant", text: "检查项目" },
      { id: "tool", type: "tool", name: "检查工具", status: "completed" },
      { id: "reply", type: "message", role: "assistant", text: "" },
    ];
    const stores = new Map(items.map(item => [item.id, createItem(item)]));
    const store = { getState: () => ({ itemStoresByKey: stores }) } as unknown as TaskStore;
    const Disclosure = Group as typeof WebGroup;
    const screen = await render(<Disclosure store={store} itemKeys={["tool"]} collapseAfterItemKey="reply"><div>原始工具过程</div></Disclosure>);
    try {
      const trigger = screen.getByRole("button");
      await expect.element(trigger).toHaveAttribute("aria-expanded", "true");
      // 只写入增量缓冲；不能依靠 item.completed 或另一组件先物化正文才触发折叠。
      const reply = stores.get("reply")!;
      reply.appendDelta({ version: 2, type: "message.delta", itemId: "reply", taskId: "task", turnId: "turn", provider: "codex", sessionId: "session", sequence: 1, timestamp: "2026-11-20T00:00:00Z", receivedAtUnixMs: 1, payload: { delta: "检查完成" } });
      reply.publish();
      await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => screen.getByText("原始工具过程").query()).toBeNull();
      const completed = items.map(item => item.id === "reply" ? { ...item, text: "检查完成" } : item) as AgentItem[];
      expect(process(completed, "completed", false, false, true)).toEqual(["progress", "tool"]);
      expect(process(completed, "running")).toEqual([]);
    } finally {
      await screen.unmount();
    }
  });
}
