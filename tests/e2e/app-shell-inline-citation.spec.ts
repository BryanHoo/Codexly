import type { WebSocketRoute } from "@playwright/test";
import {
  expect,
  taskSnapshot,
  taskSnapshotResponse,
  taskSnapshotRoute,
  test,
} from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test.describe(`来源引用 width=${String(width)}`, () => {
    test.use({ hasTouch: width === 390 });
    test(`@cross-browser 用户链接保持普通外链 width=${String(width)}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const url = "https://github.com/ones20250/Openwrt-AX6600";
      await page.route(taskSnapshotRoute("task-1"), (route) =>
        route.fulfill({
          json: {
            ...taskSnapshotResponse,
            snapshot: {
              ...taskSnapshot,
              turns: [
                {
                  ...taskSnapshot.turns[0],
                  items: [
                    { id: "user-link", type: "message", role: "user", text: `请查看 ${url}` },
                  ],
                },
              ],
            },
          },
        }),
      );
      await page.goto("/p/codexly/t/task-1");
      const link = page.locator('[data-role="user"]').getByRole("link", { name: url });
      // 等待异步 Markdown 升级后检查真实节点，不能只验证首载时的纯文本占位。
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(page.locator('[data-role="user"] [data-inline-citation]')).toHaveCount(0);
      await page.route("https://github.com/**", (route) => route.fulfill({ body: "项目页面" }));
      const popup = page.waitForEvent("popup");
      if (width === 390) await link.tap();
      else await link.click();
      await (await popup).close();
    });

    test(`@cross-browser 流式来源引用支持预览和外链 width=${String(width)}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
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
      await page.route(taskSnapshotRoute("task-1"), (route) =>
        route.fulfill({
          json: {
            ...taskSnapshotResponse,
            checkpoint: { sessionId: "e2e-session", sequence: 0 },
            snapshot: {
              ...taskSnapshot,
              status: "running",
              turns: [
                { ...taskSnapshot.turns[0], status: "running", completedAt: null, items: [] },
              ],
            },
          },
        }),
      );
      await page.goto("/p/codexly/t/task-1");
      await expect.poll(() => sockets.length).toBeGreaterThan(0);
      const emit = (delta: string, sequence: number) => {
        const event = {
          version: 2,
          provider: "codex",
          sessionId: "e2e-session",
          sequence,
          taskId: "task-1",
          turnId: "turn-1",
          itemId: "citation-message",
          timestamp: "2026-10-29T00:00:00.000Z",
          type: "message.delta",
          payload: { delta },
        };
        for (const socket of sockets)
          socket.send(JSON.stringify({ type: "events.batch", version: 3, events: [event] }));
      };
      emit("首段正文\n\n参见 [官方文档](https://", 1);
      await expect(page.getByText("首段正文", { exact: true })).toBeVisible();
      await expect(page.locator("[data-inline-citation]")).toHaveCount(0);
      const url = `https://example.com/${"long-source-".repeat(30)}`;
      emit(`${url.slice("https://".length)})`, 2);
      const trigger = page.getByRole("button", { name: "官方文档" });
      await expect(trigger).toBeVisible();
      if (width === 390) await trigger.tap();
      else await trigger.click();
      const card = page.locator('[data-slot="hover-card-content"]');
      await expect(card).toBeVisible();
      await expect(card).toContainText("官方文档");
      const link = card.getByRole("link");
      await expect(link).toHaveAttribute("href", url);
      await expect(link).toHaveAttribute("target", "_blank");
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      await trigger.evaluate((node) => Reflect.set(window, "__citationTrigger", node));
      emit("\n\n继续输出", 3);
      await expect(page.getByText("继续输出", { exact: true })).toBeVisible();
      expect(
        await trigger.evaluate((node) => node === Reflect.get(window, "__citationTrigger")),
      ).toBe(true);
      await expect(card).toBeVisible();
      const popup = page.waitForEvent("popup");
      if (width === 390) await link.tap();
      else await link.click();
      await (await popup).close();
    });
  });
}
