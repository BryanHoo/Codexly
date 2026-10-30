import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { createStore } from "zustand/vanilla";

import { i18n } from "../../../i18n/i18n.js";
import { createTaskItemStore, type TaskStore } from "../../conversation/runtime/task-store.js";
import { StoredAssistantTimelineItems } from "./task-timeline-store-operation-groups.js";
import { i18n as webI18n } from "../../../../../apps/web/src/i18n/i18n.js";
import { createTaskItemStore as createWebTaskItemStore, type TaskStore as WebTaskStore } from "../../../../../apps/web/src/features/conversation/runtime/task-store.js";
import { StoredAssistantTimelineItems as WebStoredAssistantTimelineItems } from "../../../../../apps/web/src/features/workbench/components/task-timeline-store-operation-groups.js";
import "../../../shared/styles/globals.css";

const items = [
  { id: "command-1", type: "command" as const, command: "pwd", cwd: "/workspace", status: "completed" as const, outputOmitted: { bytes: 0, lines: 0 } },
  { id: "wait-1", type: "activity" as const, label: "等待", detail: "100ms", status: "running" as const },
  { id: "command-2", type: "command" as const, command: "ls", cwd: "/workspace", status: "completed" as const, outputOmitted: { bytes: 0, lines: 0 } },
  // 历史 sleep 投影可以没有状态，也必须与前后操作一起收起。
  { id: "wait-2", type: "activity" as const, label: "等待", detail: "200ms" },
  { id: "reply", type: "message" as const, role: "assistant" as const, text: "" },
];
const props = {
  itemKeys: items.map((item) => item.id), lastTurnItemKey: "reply",
  onOpenFileDiff: () => {}, onOpenSourceFile: () => {},
  projectId: "project", taskId: "task", turnStatus: "running" as const,
};
const platforms = [
  {
    name: "desktop",
    async create() {
      await i18n.changeLanguage("zh-CN");
      const itemStoresByKey = new Map(items.map((item) => [item.id, createTaskItemStore(item)]));
      const store = createStore(() => ({ itemStoresByKey })) as unknown as TaskStore;
      return { itemStoresByKey, element: <StoredAssistantTimelineItems {...props} store={store} /> };
    },
  },
  {
    name: "web",
    async create() {
      await webI18n.changeLanguage("zh-CN");
      const itemStoresByKey = new Map(items.map((item) => [item.id, createWebTaskItemStore(item)]));
      const store = createStore(() => ({ itemStoresByKey })) as unknown as WebTaskStore;
      return { itemStoresByKey, element: <WebStoredAssistantTimelineItems {...props} store={store} /> };
    },
  },
];

for (const platform of platforms) {
  test.each([320, 960])(`${platform.name}：%spx 下等待随命令折叠并可重新展开`, async (width) => {
    const { itemStoresByKey, element } = await platform.create();
    const screen = await render(<div style={{ width }}>{element}</div>);
    const waits = screen.getByText("等待", { exact: true });
    await expect.element(waits.first()).toBeVisible();
    expect(screen.container.querySelectorAll("[data-operation-group]")).toHaveLength(1);

    // 先到达助手正文；仍在运行的等待必须阻止整组自动折叠。
    const reply = itemStoresByKey.get("reply")!;
    reply.replace({ id: "reply", type: "message", role: "assistant", text: "检查完成。" });
    reply.publish();
    await expect.element(screen.getByText("检查完成。", { exact: true })).toBeVisible();
    await expect.element(waits.first()).toBeVisible();
    const group = screen.container.querySelector("[data-operation-group]")!;
    const trigger = group.querySelector<HTMLButtonElement>(":scope > button")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const wait = itemStoresByKey.get("wait-1")!;
    wait.replace({ id: "wait-1", type: "activity", label: "等待", detail: "100ms", status: "completed" });
    wait.publish();
    await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("false");
    await expect.poll(() => waits.all().length).toBe(0);
    expect(screen.container.querySelectorAll("[data-operation-group]")).toHaveLength(1);
    expect(trigger.textContent).toContain("调用 2 个工具，执行 2 条命令");

    trigger.click();
    await expect.element(waits.first()).toBeVisible();
    expect(waits.all()).toHaveLength(2);
    waits.first().element().closest("button")!.click();
    await expect.element(screen.getByText("100ms", { exact: true })).toBeVisible();
  });
}
