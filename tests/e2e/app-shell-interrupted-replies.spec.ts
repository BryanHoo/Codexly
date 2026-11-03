import type { WebSocketRoute } from "@playwright/test";
import {
  taskSnapshotRoute,
  expect,
  test,
  taskSnapshot,
  taskSnapshotResponse,
} from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`保留中断正文并支持任务切换和页面重启 ${String(width)}px @cross-browser`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const sockets: WebSocketRoute[] = [];
    let interrupted = false;
    await page.routeWebSocket("**/v1/projects/codexly/events?*", (socket) => {
      sockets.push(socket);
      socket.send(
        JSON.stringify({
          type: "connection.ready",
          version: 3,
          sessionId: interrupted ? "restarted-session" : "e2e-session",
          latestSequence: 0,
        }),
      );
    });
    const process = {
      id: "process",
      type: "message",
      role: "assistant",
      phase: "commentary",
      text: "正在检查保存流程",
    };
    await page.route(taskSnapshotRoute("task-1"), (route) =>
      route.fulfill({
        json: {
          ...taskSnapshotResponse,
          checkpoint: { sessionId: interrupted ? "restarted-session" : "e2e-session", sequence: 0 },
          snapshot: {
            ...taskSnapshot,
            status: interrupted ? "idle" : "running",
            turns: [
              {
                ...taskSnapshot.turns[0],
                id: "turn-1",
                status: interrupted ? "interrupted" : "running",
                completedAt: null,
                items: [process],
              },
            ],
          },
        },
      }),
    );
    await page.goto("/p/codexly/t/task-1");
    await expect.poll(() => sockets.length).toBeGreaterThan(0);
    const envelope = {
      version: 2,
      provider: "codex",
      sessionId: "e2e-session",
      taskId: "task-1",
      turnId: "turn-1",
      timestamp: "2026-11-03T00:00:00Z",
    };
    const send = (events: unknown[]) => {
      for (const socket of sockets)
        socket.send(JSON.stringify({ type: "events.batch", version: 3, events }));
    };
    send([
      {
        ...envelope,
        sequence: 1,
        type: "item.started",
        itemId: "answer",
        payload: {
          item: {
            id: "answer",
            type: "message",
            role: "assistant",
            phase: "final_answer",
            text: "",
          },
        },
      },
      {
        ...envelope,
        sequence: 2,
        type: "message.delta",
        itemId: "answer",
        payload: { delta: "中断前已经生成的部分结果。" },
      },
    ]);
    const answer = page
      .getByRole("main", { name: "任务时间线" })
      .getByText("中断前已经生成的部分结果。", { exact: true });
    await expect(answer).toBeVisible();
    // 通过真实停止按钮进入既有中断请求链路，再交付原生中断终态。
    await page.getByRole("button", { name: "停止", exact: true }).click();
    interrupted = true;
    send([
      {
        ...envelope,
        sequence: 3,
        type: "turn.completed",
        payload: {
          turn: { ...taskSnapshot.turns[0], id: "turn-1", status: "interrupted", items: [process] },
        },
      },
    ]);
    await expect(answer).toBeVisible();
    await page.goto("/p/codexly/t/task-2");
    await page.goto("/p/codexly/t/task-1");
    await expect(answer).toBeVisible();
    await page.reload();
    await expect(answer).toBeVisible();
    await expect(answer).toHaveCount(1);
  });
}
