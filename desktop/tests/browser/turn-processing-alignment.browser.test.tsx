import { TurnOutputRates } from "@codexly/frontend-core/turn-output-rate";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { TurnGenerationStatus } from "@codexly/ui/agent/turn-generation-status";
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
  store.getState().turnOutputRates.current = new TurnOutputRates();
  const screen = await render(<TooltipProvider><div style={{ width: 360, height: 450 }}>
    {platform === "web" ? <WebTimeline connected store={web} {...actions} /> : <DesktopTimeline connected store={desktop} {...actions} />}
    <div data-test-queue>待发送的引导消息</div>
    <section data-test-questions>待回答的问题</section>
    <TurnGenerationStatus
      store={store} turnId={turn.id} engine="codex" generatingLabel="生成中"
      toolCallsLabel={(count) => `${count} 次工具调用`}
    />
    <textarea aria-label="任务输入" style={{ width: "100%" }} />
  </div></TooltipProvider>);
  const timer = () => screen.container.querySelector<HTMLElement>("[data-turn-processing-time]");
  const status = () => screen.container.querySelector("[data-turn-generation-status]");
  const speed = () => status()?.lastElementChild?.textContent;
  expect(timer()?.textContent).not.toContain("t/s");
  expect(status()?.textContent).toContain("生成中");
  expect(status()?.textContent).toContain("0 次工具调用");
  const statusRow = status()!;
  const input = screen.container.querySelector("textarea")!;
  const statusBounds = statusRow.getBoundingClientRect();
  for (const selector of ["[data-test-queue]", "[data-test-questions]"]) {
    expect(screen.container.querySelector(selector)!.getBoundingClientRect().bottom).toBeLessThanOrEqual(statusBounds.top);
  }
  expect(statusBounds.bottom).toBeLessThanOrEqual(input.getBoundingClientRect().top);
  // 用实际内容的左右边缘计算中心，覆盖窄屏与宽屏的输入框。
  const fixture = statusRow.parentElement!;
  for (const width of [360, 1280]) {
    fixture.style.width = `${width}px`;
    const left = statusRow.firstElementChild!.getBoundingClientRect().left;
    const right = statusRow.lastElementChild!.getBoundingClientRect().right;
    const inputBounds = input.getBoundingClientRect();
    expect(Math.abs((left + right) / 2 - (inputBounds.left + inputBounds.width / 2))).toBeLessThanOrEqual(1);
  }
  fixture.style.width = "360px";
  expect(status()?.textContent).not.toContain("t/s");
  expect(speed()).toBe("· 0 次工具调用");
  const event = { version: 2, provider: "claude", sessionId: "session", taskId: identity.taskId, turnId: turn.id, timestamp } as const;
  const reported = { ...event, sequence: 1, type: "usage.updated", payload: { usage: { usedTokens: 500, contextWindow: 10000 }, outputTokens: 0 } } as const;
  const message = { ...event, sequence: 2, type: "message.delta", itemId: "acp:message:assistant:reply", payload: { delta: "streaming output ".repeat(10) } } as const;
  const tool = { id: "tool", type: "tool", name: "read", status: "running" } as const;
  const startedAt = Date.parse(timestamp);
  const applyEvents = store.getState().applyEvents;
  const receive = (elapsed: number, events: Parameters<typeof applyEvents>[0]) => {
    const eventTimestamp = new Date(startedAt + elapsed).toISOString();
    applyEvents(events.map((entry) => ({ ...entry, timestamp: eventTimestamp })));
  };
  receive(0, [reported, message, { ...event, sequence: 3, type: "item.started", itemId: tool.id, payload: { item: tool } }]);
  await expect.poll(() => status()?.textContent).toContain("1 次工具调用");
  // 单批输出也应立即显示估算。第二批到达后，推理和回答共用实际采样间隔。
  await expect.poll(speed, { timeout: 500 }).toBe("· 43.0 t/s");
  receive(1_000, [{ ...message, sequence: 4, type: "reasoning.delta", itemId: "reasoning" }]);
  await expect.poll(speed, { timeout: 2_000 }).toBe("· 42.0 t/s");
  receive(2_000, [{ ...reported, sequence: 5, payload: { ...reported.payload, outputTokens: 2_480 } }]);
  await expect.poll(speed, { timeout: 2_000 }).toBe("· 1.2k t/s");
  // 等待工具时重复的累计值只确认了原有计数，保留已测速度。
  receive(10_000, [{ ...reported, sequence: 6, payload: { ...reported.payload, outputTokens: 2_480 } }]);
  expect(speed()).toBe("· 1.2k t/s");
  receive(11_000, [{ ...event, sequence: 7, type: "turn.completed", payload: { turn: { ...turn, status: "completed", completedAt: new Date().toISOString() } } }]);
  await expect.poll(status).toBeNull();
  await screen.unmount();
}, 10_000);

for (const [platform, Timer] of [["web", WebTimer], ["desktop", DesktopTimer]] as const) {
  it(`${platform} 执行过程标题只显示耗时`, async () => {
    const screen = await render(<Timer status="running" startedAt={null} completedAt={null} />);
    const timer = screen.container.querySelector<HTMLElement>("[data-turn-processing-time]");
    expect(timer?.textContent).not.toContain("t/s");
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
