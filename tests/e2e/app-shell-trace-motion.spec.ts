import type { AgentItem } from "@codexly/protocol";
import { taskSnapshotRoute, expect, taskSnapshot, test } from "./fixtures/app-shell.js";

test.use({
  video: { mode: "on", size: { width: 1280, height: 800 } },
  viewport: { width: 1280, height: 800 },
});

for (const { reduced, width, theme } of [
  { reduced: false, width: 1280, theme: "light" },
  { reduced: false, width: 390, theme: "dark" },
  { reduced: true, width: 1280, theme: "dark" },
  { reduced: true, width: 390, theme: "light" },
] as const) {
  test(`Trace 逐步执行、状态图标与减弱动态效果 (${String(reduced)}, ${String(width)}px, ${theme}) @cross-browser`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript((theme) => {
      localStorage.setItem("codexly.theme-preference", JSON.stringify({ theme, version: 1 }));
    }, theme);
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    const timestamp = new Date().toISOString();
    const items: AgentItem[] = [
      {
        id: "trace-user",
        type: "message",
        role: "user",
        text: "检查工作区，再运行测试，告诉我结果。",
      },
      {
        id: "trace-reasoning",
        type: "reasoning",
        content: "",
        summary: "先检查工作区，再运行有针对性的测试。\n\n只读取必要文件，保持现有改动。",
      },
    ];
    let sequence = 0;
    await page.route(taskSnapshotRoute("task-1"), async (route) => {
      await route.fulfill({
        json: {
          checkpoint: { sequence, sessionId: "trace-session" },
          snapshot: {
            ...taskSnapshot,
            title: "检查工作区与测试",
            status: "running",
            turns: [
              {
                id: "trace-turn",
                status: "running",
                completedAt: null,
                error: null,
                startedAt: timestamp,
                items,
              },
            ],
          },
        },
      });
    });
    await page.addInitScript(() => {
      type TraceWindow = Window & {
        __traceEmit?: (event: unknown) => void;
        __traceEntries?: number;
      };
      const target = window as TraceWindow;
      target.__traceEntries = 0;
      // 保留原型方法并在下面用 call 显式绑定实际元素。
      // oxlint-disable-next-line typescript/unbound-method
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (typeof options === "object" && options.id === "agent-entry")
          target.__traceEntries = (target.__traceEntries ?? 0) + 1;
        return animate.call(this, frames, options);
      };
      class TraceSocket extends EventTarget {
        public readonly bufferedAmount = 0;
        public readyState = 0;
        public constructor() {
          super();
          target.__traceEmit = (event) =>
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({ events: [event], type: "events.batch", version: 3 }),
              }),
            );
          queueMicrotask(() => {
            this.readyState = 1;
            this.dispatchEvent(new Event("open"));
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  latestSequence: 0,
                  sessionId: "trace-session",
                  type: "connection.ready",
                  version: 3,
                }),
              }),
            );
          });
        }
        public send(): void {
          return undefined;
        }
        public close(code = 1000, reason = ""): void {
          this.readyState = 3;
          this.dispatchEvent(new CloseEvent("close", { code, reason }));
        }
      }
      Object.defineProperty(window, "WebSocket", { configurable: true, value: TraceSocket });
    });
    await page.goto("/p/codexly/t/task-1");
    const thinking = page.locator("[data-reasoning-summary]");
    await expect(thinking.getByRole("button")).toHaveAttribute("aria-expanded", "true");
    await expect(thinking.locator('[data-slot="trace-title"]')).toHaveCSS(
      "animation-name",
      reduced ? "none" : "agent-shimmer",
    );
    expect(
      await page.evaluate(() => (window as Window & { __traceEntries?: number }).__traceEntries),
    ).toBe(0);

    const emitItem = async (item: AgentItem, type: "item.started" | "item.completed") => {
      const index = items.findIndex((current) => current.id === item.id);
      if (index < 0) items.push(item);
      else items[index] = item;
      sequence += 1;
      await page.evaluate(
        (event) =>
          (window as Window & { __traceEmit?: (event: unknown) => void }).__traceEmit?.(event),
        {
          version: 2,
          provider: "codex",
          sessionId: "trace-session",
          taskId: "task-1",
          turnId: "trace-turn",
          itemId: item.id,
          timestamp: new Date().toISOString(),
          sequence,
          type,
          payload: { item },
        },
      );
    };
    // 仅测试录屏用间隔模拟真实执行耗时；生产界面从不人工延迟已到达的数据。
    if (!reduced) await page.waitForTimeout(850);
    const command: AgentItem = {
      id: "trace-command",
      type: "command",
      command: "git status --short",
      cwd: "/workspace/Codexly",
      status: "running",
      outputOmitted: { bytes: 0, lines: 0 },
    };
    await emitItem(command, "item.started");
    const commandButton = page.getByRole("button", { name: /git status --short/ });
    await expect(commandButton.locator('[data-slot="trace-status-icon"]')).toHaveAttribute(
      "data-status",
      "running",
    );
    await expect
      .poll(
        async () =>
          await page.evaluate(
            () => (window as Window & { __traceEntries?: number }).__traceEntries,
          ),
      )
      .toBe(reduced ? 0 : 1);
    await expect(thinking.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    if (!reduced) await page.waitForTimeout(850);
    await emitItem(
      {
        ...command,
        status: "completed",
        output: " M packages/ui/src/core/trace.tsx\n M packages/ui/src/agent/tool.tsx",
      },
      "item.completed",
    );
    await expect(commandButton.locator('[data-slot="trace-status-icon"]')).toHaveAttribute(
      "data-status",
      "completed",
    );
    await expect(commandButton.locator('[data-slot="trace-title"]')).toHaveText(
      "git status --short",
    );
    expect(await commandButton.innerText()).not.toContain("已完成");
    await commandButton.click();
    await expect(page.locator('[data-slot="terminal-content"]')).toContainText(
      "packages/ui/src/core/trace.tsx",
    );
    if (!reduced) await page.waitForTimeout(850);
    const checks: AgentItem = {
      ...command,
      id: "trace-tests",
      command: "pnpm test",
      status: "running",
    };
    await emitItem(checks, "item.started");
    await expect(page.getByRole("button", { name: /pnpm test/ })).toBeVisible();
    if (!reduced) await page.waitForTimeout(850);
    await emitItem({ ...checks, status: "completed", output: "42 tests passed" }, "item.completed");
    await emitItem(
      {
        id: "trace-answer",
        type: "message",
        role: "assistant",
        text: "检查完成，测试全部通过。\n\n工作区保留了现有改动，执行过程可以随时展开查看。",
      },
      "item.started",
    );
    await expect(page.getByText("检查完成，测试全部通过。", { exact: true })).toBeVisible();
    expect(
      await page
        .locator('[data-slot="message-scroller-viewport"]')
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    sequence += 1;
    await page.evaluate(
      (event) =>
        (window as Window & { __traceEmit?: (event: unknown) => void }).__traceEmit?.(event),
      {
        version: 2,
        provider: "codex",
        sessionId: "trace-session",
        taskId: "task-1",
        turnId: "trace-turn",
        timestamp: new Date().toISOString(),
        sequence,
        type: "turn.completed",
        payload: {
          turn: {
            id: "trace-turn",
            status: "completed",
            startedAt: timestamp,
            completedAt: new Date().toISOString(),
            error: null,
            items,
          },
        },
      },
    );
    await expect(page.getByRole("button", { name: "停止", exact: true })).toBeHidden();
    if (!reduced) await page.waitForTimeout(1000);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({ path: testInfo.outputPath("trace-result.png") });
  });
}
