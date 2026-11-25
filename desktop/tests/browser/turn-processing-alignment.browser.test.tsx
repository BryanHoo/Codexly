import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { createTaskStore as createWebStore } from "../../../apps/web/src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as WebTimeline } from "../../../apps/web/src/features/workbench/components/task-timeline-store.js";
import { TurnProcessingTime as WebTimer } from "../../../apps/web/src/features/workbench/components/task-timeline-status.js";
import { createTaskStore as createDesktopStore } from "../../src/features/conversation/runtime/task-store.js";
import { TaskStoreTimeline as DesktopTimeline } from "../../src/features/workbench/components/task-timeline-store.js";
import { TurnProcessingTime as DesktopTimer } from "../../src/features/workbench/components/task-timeline-status.js";
import "../../src/shared/styles/globals.css";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";

it.each(["web", "desktop"])("%s 在窄屏任务整个运行过程中显示速率，完成后隐藏", async (platform) => {
  const timestamp = new Date().toISOString();
  const turn = { id: "turn", status: "running" as const, startedAt: timestamp, completedAt: null, error: null, items: [] };
  const identity = { projectId: "project", taskId: "task" };
  const response = { checkpoint: { sessionId: "session", sequence: 0 }, snapshot: {
    id: "task", projectId: "project", title: "Task", pinned: false, status: "running" as const,
    updatedAt: timestamp, pendingRequests: [], turnsNextCursor: null, contextUsage: null, goal: null, plan: null,
    settings: { approvalPolicy: "on-request" as const, approvalsReviewer: "user" as const, model: "model", reasoningEffort: "high" as const, sandboxMode: "workspace-write" as const },
    turns: [turn],
  } };
  const actions = { onOpenFileDiff: () => {}, onOpenSourceFile: () => {}, onReviewFileChanges: () => {}, onResolvePendingRequest: async () => {} };
  const web = createWebStore(identity, response);
  const desktop = createDesktopStore(identity, response);
  const store = platform === "web" ? web : desktop;
  const screen = await render(<TooltipProvider><div style={{ width: 360, height: 450 }}>
    {platform === "web" ? <WebTimeline connected store={web} {...actions} /> : <DesktopTimeline connected store={desktop} {...actions} />}
  </div></TooltipProvider>);
  const timer = () => screen.container.querySelector<HTMLElement>("[data-turn-processing-time]");
  const speed = () => timer()?.querySelector("time")?.nextElementSibling?.textContent;
  expect(speed()).toBe("· 0.0 t/s");
  const event = { version: 2, provider: "claude", sessionId: "session", taskId: identity.taskId, turnId: turn.id, timestamp } as const;
  const reported = { ...event, sequence: 1, type: "usage.updated", payload: { usage: { usedTokens: 500, contextWindow: 10000 }, outputTokens: 0 } } as const;
  const message = { ...event, sequence: 2, type: "message.delta", itemId: "acp:message:assistant:reply", payload: { delta: "streaming output ".repeat(10) } } as const;
  store.getState().applyEvents([reported, message]);
  // ACP 可能把短答复合并为单个文本块，收到这一批就应显示非零速率。
  await expect.poll(speed, { timeout: 2_000 }).toMatch(/^· [1-9]\d*\.\d t\/s$/);
  // 流式估算只有几十 t/s。收到已上报的差值后，两端都应切换到 k t/s。
  store.getState().applyEvents([{ ...reported, sequence: 3, payload: { ...reported.payload, outputTokens: 10000 } }]);
  await expect.poll(speed, { timeout: 2_000 }).toMatch(/^· [1-9]\d*\.\dk t\/s$/);
  await expect.poll(speed, { timeout: 5_000 }).toBe("· 0.0 t/s");
  store.getState().applyEvents([{ ...message, sequence: 4 }]);
  await expect.poll(speed, { timeout: 2_000 }).toMatch(/^· [1-9]\d*\.\d t\/s$/);
  store.getState().applyEvents([{ ...event, sequence: 5, type: "turn.completed", payload: { turn: { ...turn, status: "completed", completedAt: new Date().toISOString() } } }]);
  await expect.poll(() => timer()?.textContent ?? "").not.toContain("t/s");
  await screen.unmount();
}, 10_000);

for (const [platform, Timer] of [["web", WebTimer], ["desktop", DesktopTimer]] as const) {
  it(`${platform} 速率跨位数变化时，窄屏计时栏的展开箭头不移动`, async () => {
    const startedAt = new Date().toISOString();
    const timer = (rate: number) => (
      <div style={{ width: 360 }}>
        <Timer status="running" startedAt={startedAt} completedAt={null} readOutputRate={() => rate} onToggle={() => undefined} />
      </div>
    );
    const screen = await render(timer(0));
    const header = screen.container.querySelector<HTMLElement>("[data-turn-processing-time]")!;
    const speed = header.querySelector("time")!.nextElementSibling!;
    const arrow = header.lastElementChild!;
    const arrowLeft = arrow.getBoundingClientRect().left;
    for (const [rate, expected] of [[86, "86.0 t/s"], [412, "412.0 t/s"], [999.9, "999.9 t/s"], [999.95, "1.0k t/s"], [1240, "1.2k t/s"]] as const) {
      await screen.rerender(timer(rate));
      expect(speed.textContent).toContain(expected);
      expect(Math.abs(arrow.getBoundingClientRect().left - arrowLeft)).toBeLessThan(0.5);
    }
    await screen.unmount();
  });
  it(`${platform} 运行时间未知时仍显示速率`, async () => {
    const screen = await render(<Timer status="running" startedAt={null} completedAt={null} />);
    const timer = screen.container.querySelector<HTMLElement>("[data-turn-processing-time]");
    expect(timer?.textContent).toContain("0.0 t/s");
    expect(timer?.querySelector("time")).toBeNull();
    await screen.unmount();
  });
  it(`${platform} 显示持续计时和完成耗时，不把折叠动作当作标题`, async () => {
    await Promise.all([webLanguage("zh-CN"), nativeLanguage("zh-CN")]);
    const start = new Date(Date.now() - 3000).toISOString();
    const screen = await render(<Timer status="running" startedAt={start} completedAt={null} onToggle={() => undefined} />);
    const timer = screen.container.querySelector<HTMLElement>("[data-turn-processing-time]")!;
    const first = timer.querySelector("time")!.textContent;
    await expect.poll(() => timer.querySelector("time")!.textContent).not.toBe(first);
    await screen.rerender(<Timer status="completed" startedAt={start} completedAt={new Date(Date.parse(start) + 12000).toISOString()} onToggle={() => undefined} />);
    expect(timer.textContent).toContain("已完成");
    expect(timer.querySelector("time")!.textContent).toBe("12s");
    expect(timer.textContent).not.toContain("展开执行过程");
    await screen.rerender(<Timer status="completed" startedAt={null} completedAt={null} onToggle={() => undefined} />);
    expect(timer.textContent).toContain("已完成");
    expect(timer.textContent).toContain("耗时未知");
    expect(timer.querySelector("time")).toBeNull();
    await screen.unmount();
  });
  it.each([360, 1280])(`${platform} 计时栏在 %ipx 宽度下垂直居中`, async (width) => {
    const screen = await render(
      <div style={{ width }}>
        <Timer status="completed" startedAt="2026-11-06T00:00:00Z"
          completedAt="2026-11-06T00:03:58Z" onToggle={() => undefined} />
      </div>,
    );
    const timer = screen.container.querySelector<HTMLElement>("[data-turn-processing-time]")!;
    const bounds = timer.getBoundingClientRect();
    const center = bounds.top + bounds.height / 2;
    // 测量真实布局而非类名，确保图标、文字、耗时和箭头均位于整栏的垂直中心。
    expect(timer.querySelector("time")?.textContent).toBe("3m 58s");
    for (const child of timer.children) {
      const rect = child.getBoundingClientRect();
      expect(Math.abs(rect.top + rect.height / 2 - center)).toBeLessThanOrEqual(1);
    }
  });
}
