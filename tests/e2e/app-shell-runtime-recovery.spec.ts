import { expect, taskSnapshotResponse, test } from "./fixtures/app-shell.js";

test.describe.configure({ mode: "serial" });

test("shows a task error when the initial snapshot request fails", async ({ page }) => {
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
      status: 500,
    });
  });

  await page.goto("/p/codexly/t/task-1");

  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveText("无法加载任务历史");
});

test("keeps retrying Snapshot recovery and applies later realtime events", async ({ page }) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    if (snapshotRequestCount === 1) {
      await route.fulfill({ contentType: "application/json", json: taskSnapshotResponse });
      return;
    }
    if (snapshotRequestCount <= 3) {
      await route.fulfill({
        contentType: "application/json",
        json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
        status: 503,
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        checkpoint: { sequence: 8, sessionId: "e2e-session" },
      },
    });
  });
  await page.addInitScript(() => {
    class ResyncWebSocket extends EventTarget {
      static connectionCount = 0;
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        ResyncWebSocket.connectionCount += 1;
        const connectionCount = ResyncWebSocket.connectionCount;
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          const messages =
            connectionCount === 1
              ? [
                  {
                    latestSequence: 0,
                    sessionId: "e2e-session",
                    type: "connection.ready",
                    version: 3,
                  },
                  {
                    latestSequence: 8,
                    reason: "event_retention_exceeded",
                    sessionId: "e2e-session",
                    type: "resync.required",
                    version: 3,
                  },
                ]
              : [
                  {
                    latestSequence: 8,
                    sessionId: "e2e-session",
                    type: "connection.ready",
                    version: 3,
                  },
                  {
                    events: [
                      {
                        itemId: "message-recovered",
                        payload: {
                          item: {
                            id: "message-recovered",
                            role: "assistant",
                            text: "恢复失败后收到的实时消息",
                            type: "message",
                          },
                        },
                        provider: "codex",
                        sequence: 9,
                        sessionId: "e2e-session",
                        taskId: "task-1",
                        timestamp: "2026-07-23T00:00:00.000Z",
                        turnId: "turn-1",
                        type: "item.completed",
                        version: 2,
                      },
                    ],
                    type: "events.batch",
                    version: 3,
                  },
                ];
          for (const message of messages) {
            this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }));
          }
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: ResyncWebSocket,
    });
  });

  await page.goto("/p/codexly/t/task-1");

  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(3);
  await expect(page.getByText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。")).toBeVisible();
  await expect(page.getByText("实时连接恢复中")).toBeVisible();

  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(4);
  await expect(page.getByText("恢复失败后收到的实时消息")).toBeVisible();
  await expect(page.getByText("实时连接恢复中")).toHaveCount(0);
});

test("refreshes the snapshot when the realtime delta buffer overflows", async ({ page }) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        ...taskSnapshotResponse,
        checkpoint: {
          ...taskSnapshotResponse.checkpoint,
          sequence: snapshotRequestCount === 1 ? 0 : 1_001,
        },
      },
    });
  });
  await page.addInitScript(() => {
    let connectionCount = 0;

    class BurstingWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        connectionCount += 1;
        const shouldSendBurst = connectionCount <= 2;
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(
            new MessageEvent("message", {
              data: JSON.stringify({
                latestSequence: 1_001,
                sessionId: "e2e-session",
                type: "connection.ready",
                version: 3,
              }),
            }),
          );
          if (!shouldSendBurst) {
            return;
          }
          const events = Array.from({ length: 1_001 }, (_, index) => {
            const sequence = index + 1;
            return {
              itemId: `item-${String(sequence % 2)}`,
              payload: { delta: "x" },
              provider: "codex",
              sequence,
              sessionId: "e2e-session",
              taskId: "task-1",
              timestamp: "2026-07-23T00:00:00.000Z",
              turnId: "turn-1",
              type: "message.delta",
              version: 2,
            };
          });
          for (let offset = 0; offset < events.length; offset += 64) {
            this.dispatchEvent(
              new MessageEvent("message", {
                data: JSON.stringify({
                  events: events.slice(offset, offset + 64),
                  type: "events.batch",
                  version: 3,
                }),
              }),
            );
          }
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: BurstingWebSocket,
    });
  });

  await page.goto("/p/codexly/t/task-1");

  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(2);
});

test("clears transient realtime errors after the WebSocket reconnects @cross-browser", async ({
  page,
}) => {
  let snapshotRequestCount = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1", async (route) => {
    snapshotRequestCount += 1;
    if (snapshotRequestCount === 1) {
      await route.fulfill({ contentType: "application/json", json: taskSnapshotResponse });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { code: "SNAPSHOT_FAILED", message: "Snapshot failed" },
      status: 503,
    });
  });
  await page.addInitScript(() => {
    let connectionCount = 0;
    sessionStorage.setItem("__testWebSocketConnections", String(connectionCount));
    sessionStorage.setItem("__testWebSocketFailed", "false");
    sessionStorage.setItem("__testWebSocketRecovered", "false");

    class ReconnectingWebSocket extends EventTarget {
      public readonly bufferedAmount = 0;
      public readyState = 0;

      public constructor() {
        super();
        connectionCount += 1;
        const shouldFail = connectionCount <= 2;
        sessionStorage.setItem("__testWebSocketConnections", String(connectionCount));
        queueMicrotask(() => {
          if (this.readyState === 3) {
            return;
          }
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          const sendReady = () => {
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
          };
          if (!shouldFail) {
            setTimeout(() => {
              if (this.readyState === 3) {
                return;
              }
              sendReady();
              sessionStorage.setItem("__testWebSocketRecovered", "true");
            }, 1_000);
            return;
          }
          sendReady();
          setTimeout(() => {
            sessionStorage.setItem("__testWebSocketFailed", "true");
            this.dispatchEvent(new Event("error"));
            this.readyState = 3;
            this.dispatchEvent(new CloseEvent("close", { code: 1006 }));
          }, 200);
        });
      }

      public close(code = 1000, reason = ""): void {
        if (this.readyState === 3) {
          return;
        }
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close", { code, reason }));
      }

      public send(): void {
        return undefined;
      }
    }

    // 在应用创建连接前替换浏览器实现，稳定复现失败后成功重连。
    Object.defineProperty(window, "WebSocket", {
      configurable: true,
      value: ReconnectingWebSocket,
    });
  });

  await page.goto("/p/codexly/t/task-1");
  await expect(page.getByText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。")).toBeVisible();
  await expect.poll(() => page.evaluate(() => WebSocket.name)).toBe("ReconnectingWebSocket");
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("__testWebSocketFailed")))
    .toBe("true");
  await expect.poll(() => snapshotRequestCount).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(50);

  // Snapshot 刷新失败属于非阻塞恢复错误，已渲染 Timeline 不能被替换。
  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveCount(0);
  await expect(page.getByText("工作台界面已按统一的 项目 Agent 组件 结构重新组织。")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => Number(sessionStorage.getItem("__testWebSocketConnections") ?? "0")),
    )
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("__testWebSocketRecovered")))
    .toBe("true");

  await expect(page.getByRole("alert", { name: "会话内容" })).toHaveCount(0);
});
