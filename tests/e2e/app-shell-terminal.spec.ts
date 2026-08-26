import { expect, taskSnapshot, test } from "./fixtures/app-shell.js";

const command = "pnpm terminal-scroll-test";
const initialOutput = Array.from(
  { length: 120 },
  (_, index) => `terminal output line ${String(index + 1)}`,
).join("\n");

test("pauses terminal auto-scroll while the user reads earlier output", async ({ page }) => {
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        checkpoint: { sequence: 0, sessionId: "terminal-scroll-session" },
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              completedAt: null,
              error: null,
              id: "turn-terminal-scroll",
              items: [
                {
                  id: "message-terminal-scroll",
                  role: "user",
                  text: "检查终端滚动",
                  type: "message",
                },
                {
                  command,
                  cwd: "/workspace/Codexly",
                  id: "command-terminal-scroll",
                  output: initialOutput,
                  outputOmitted: { bytes: 0, lines: 0 },
                  status: "running",
                  type: "command",
                },
              ],
              startedAt: "2026-08-26T00:00:00.000Z",
              status: "running",
            },
          ],
        },
      },
    });
  });
  await page.addInitScript(() => {
    type TerminalEventWindow = Window & {
      __emitTerminalEvent?: (event: unknown) => void;
    };

    class TerminalWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        (window as TerminalEventWindow).__emitTerminalEvent = (event) => {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({ events: [event], type: "events.batch", version: 3 }),
            }),
          );
        };
        queueMicrotask(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 0,
                sessionId: "terminal-scroll-session",
                type: "connection.ready",
                version: 3,
              }),
            }),
          );
        });
      }

      public close(code = 1000, reason = ""): void {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: TerminalWebSocket,
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await page.locator("summary").filter({ hasText: command }).click();

  const terminal = page.locator('[data-slot="terminal"]');
  const terminalContent = terminal.locator('[data-slot="terminal-content"]');
  await expect(terminalContent).toBeVisible();
  await expect
    .poll(() => terminal.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe("rgb(24, 24, 24)");
  await expect
    .poll(() =>
      terminal.locator('[data-slot="terminal-title"] svg').evaluate((element) => {
        const style = getComputedStyle(element);
        return { height: style.height, width: style.width };
      }),
    )
    .toEqual({ height: "14px", width: "14px" });
  await expect
    .poll(() => terminalContent.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const emitEvent = async (event: Record<string, unknown>) => {
    await page.evaluate((terminalEvent) => {
      const emit = (window as Window & { __emitTerminalEvent?: (value: unknown) => void })
        .__emitTerminalEvent;
      if (emit === undefined) throw new Error("Terminal event emitter is unavailable");
      emit(terminalEvent);
    }, event);
  };
  const createDelta = (delta: string, sequence: number) => ({
    itemId: "command-terminal-scroll",
    payload: { delta },
    provider: "codex",
    sequence,
    sessionId: "terminal-scroll-session",
    taskId: "task-1",
    timestamp: `2026-08-26T00:00:0${String(sequence)}.000Z`,
    turnId: "turn-terminal-scroll",
    type: "command.output_delta",
    version: 2,
  });

  // 用户离开底部后，新输出不得打断当前阅读位置。
  await terminalContent.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await emitEvent(createDelta("\noutput while reading history", 1));
  await expect(terminalContent).toContainText("output while reading history");
  await expect.poll(() => terminalContent.evaluate((element) => element.scrollTop)).toBeLessThan(2);

  // 用户主动回到底部后，后续输出恢复自动跟随。
  await terminalContent.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await emitEvent(createDelta("\noutput after returning to bottom", 2));
  await expect(terminalContent).toContainText("output after returning to bottom");
  await expect
    .poll(() =>
      terminalContent.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThan(2);

  // 命令完成时仍尊重用户已经暂停的阅读位置。
  await terminalContent.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const completedOutput = `${initialOutput}\noutput while reading history\noutput after returning to bottom`;
  await emitEvent({
    itemId: "command-terminal-scroll",
    payload: {
      item: {
        command,
        cwd: "/workspace/Codexly",
        exitCode: 0,
        id: "command-terminal-scroll",
        output: completedOutput,
        outputOmitted: { bytes: 0, lines: 0 },
        status: "completed",
        type: "command",
      },
    },
    provider: "codex",
    sequence: 3,
    sessionId: "terminal-scroll-session",
    taskId: "task-1",
    timestamp: "2026-08-26T00:00:03.000Z",
    turnId: "turn-terminal-scroll",
    type: "item.completed",
    version: 2,
  });
  await expect.poll(() => terminalContent.evaluate((element) => element.scrollTop)).toBeLessThan(2);

  await page.setViewportSize({ height: 640, width: 320 });
  await expect
    .poll(() => terminal.evaluate((element) => element.scrollWidth <= element.clientWidth))
    .toBe(true);
});
