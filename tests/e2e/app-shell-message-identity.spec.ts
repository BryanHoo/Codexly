import type { WebSocketRoute } from "@playwright/test";
import { expect, test, taskSnapshot, taskSnapshotResponse } from "./fixtures/app-shell.js";

test("replaces an explicit message alias without duplicate bubbles @cross-browser", async ({
  page,
}) => {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket("**/v1/projects/codexly/events?*", (socket) => {
    sockets.push(socket);
    socket.send(
      JSON.stringify({
        type: "connection.ready",
        version: 3,
        sessionId: "e2e-session",
        latestSequence: 0,
      }),
    );
  });
  await page.route("**/v1/projects/codexly/tasks/task-1", (route) =>
    route.fulfill({
      json: {
        ...taskSnapshotResponse,
        checkpoint: { sessionId: "e2e-session", sequence: 0 },
        snapshot: {
          ...taskSnapshot,
          status: "running",
          turns: [
            {
              ...taskSnapshot.turns[0],
              status: "running",
              completedAt: null,
              items: [
                { id: "snapshot-message", type: "message", role: "assistant", text: "旧快照内容" },
              ],
            },
          ],
        },
      },
    }),
  );
  await page.goto("/p/codexly/t/task-1");
  const timeline = page.getByRole("main", { name: "任务时间线" });
  await expect(timeline.getByText("旧快照内容", { exact: true })).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  // 正文故意不同，验证浏览器依赖显式别名，而不是文本相似度。
  const event = {
    version: 2,
    provider: "codex",
    sessionId: "e2e-session",
    sequence: 1,
    taskId: "task-1",
    turnId: "turn-1",
    itemId: "canonical-message",
    timestamp: "2026-09-12T00:00:00.000Z",
    type: "item.completed",
    payload: {
      item: {
        id: "canonical-message",
        identityAliases: ["snapshot-message"],
        type: "message",
        role: "assistant",
        text: "服务端确认的完整消息",
      },
    },
  };
  for (const socket of sockets)
    socket.send(JSON.stringify({ type: "events.batch", version: 3, events: [event] }));
  await expect(timeline.getByText("服务端确认的完整消息", { exact: true })).toHaveCount(1);
  await expect(timeline.getByText("旧快照内容", { exact: true })).toHaveCount(0);
});
