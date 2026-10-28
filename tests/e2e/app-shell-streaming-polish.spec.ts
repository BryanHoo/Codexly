import {
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  taskSnapshotRoute,
  test,
} from "./fixtures/app-shell.js";

type StreamingPolishWindow = Window & { __emitStreamingPolish?: (event: unknown) => void };

for (const width of [390, 1280]) {
  for (const reduced of [false, true]) {
    test(`@cross-browser 流式追加保持可读与输入响应 width=${String(width)} reduced=${String(reduced)}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      const turn = taskSnapshot.turns[0];
      if (turn === undefined) throw new Error("Expected a fixture turn");
      await page.route(taskSnapshotRoute("task-1"), async (route) => {
        await route.fulfill({
          json: {
            ...taskSnapshotResponse,
            snapshot: {
              ...taskSnapshot,
              status: "running",
              turns: [{ ...turn, status: "running", completedAt: null, items: [] }],
            },
          },
        });
      });
      await page.addInitScript(() => {
        const NativeWebSocket = window.WebSocket;
        class StreamingSocket extends EventTarget {
          public readonly bufferedAmount: number = 0;
          public readyState = 0;
          public constructor(url: string) {
            super();
            // 只替换项目事件连接，使用正式事件批次协议驱动真实工作台。
            if (new URL(url).pathname !== "/v1/projects/codexly/events") {
              return new NativeWebSocket(url);
            }
            Reflect.set(window, "__emitStreamingPolish", (event: unknown) => {
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({ events: [event], type: "events.batch", version: 3 }),
                }),
              );
            });
            queueMicrotask(() => {
              this.readyState = 1;
              this.dispatchEvent(new Event("open"));
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: JSON.stringify({
                    latestSequence: 0,
                    sessionId: "e2e-session",
                    type: "connection.ready",
                    version: 3,
                  }),
                }),
              );
            });
          }
          public close(code = 1000, reason = "") {
            this.readyState = 3;
            this.dispatchEvent(new CloseEvent("close", { code, reason }));
          }
          public send(_data: string | BufferSource | Blob): void {
            return undefined;
          }
        }
        Object.defineProperty(window, "WebSocket", { configurable: true, value: StreamingSocket });
      });
      await page.goto("/p/codexly/t/task-1");
      await expect
        .poll(() => page.evaluate(() => typeof Reflect.get(window, "__emitStreamingPolish")))
        .toBe("function");
      const emit = async (delta: string, sequence: number) => {
        await page.evaluate(
          ({ delta, sequence, turnId }) => {
            const dispatch = (window as StreamingPolishWindow).__emitStreamingPolish;
            if (dispatch === undefined) throw new Error("Missing streaming event connection");
            dispatch({
              itemId: "streaming-polish-message",
              payload: { delta },
              provider: "codex",
              sequence,
              sessionId: "e2e-session",
              taskId: "task-1",
              timestamp: "2026-10-28T00:00:00.000Z",
              turnId,
              type: "message.delta",
              version: 2,
            });
          },
          { delta, sequence, turnId: turn.id },
        );
      };
      await emit("首批流式正文", 1);
      const reveal = page.locator("[data-streaming-text-reveal]");
      await expect(reveal).toHaveText("首批流式正文");
      await reveal.evaluate((node) => Reflect.set(window, "__previousStreamingReveal", node));
      await emit("第二批流式正文", 2);
      await expect(reveal).toHaveText("第二批流式正文");
      expect(
        await reveal.evaluate((node) => node !== Reflect.get(window, "__previousStreamingReveal")),
      ).toBe(true);
      await expect(reveal).toHaveCSS("animation-name", reduced ? "none" : "agent-text-reveal");
      await expect(page.getByText("首批流式正文第二批流式正文", { exact: true })).toBeVisible();
      const conversation = page.getByRole("region", { name: "会话内容" });
      expect(await conversation.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
        true,
      );
      const composer = page.getByRole("textbox", { name: "任务输入" });
      await composer.fill("继续输出时也能输入");
      await emit("第三批流式正文", 3);
      await expect(reveal).toHaveText("第三批流式正文");
      await expect(composer).toHaveText("继续输出时也能输入");
      await expect(composer).toBeFocused();
    });
  }
}
