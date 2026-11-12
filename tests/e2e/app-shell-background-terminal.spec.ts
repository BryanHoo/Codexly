import { expect, test } from "./fixtures/app-shell.js";

test("旧运行时保持后台终端查询与停止流程", async ({ page }) => {
  const command = "pnpm background-proof";
  let stopped = false;
  let terminations = 0;
  await page.route("**/v1/projects/codexly/tasks/task-1/background-terminals", (route) =>
    route.fulfill({
      json: {
        data: stopped
          ? []
          : [{ id: "proof", itemId: "item-proof", command, cwd: "/workspace/Codexly" }],
      },
    }),
  );
  await page.route(
    "**/v1/projects/codexly/tasks/task-1/background-terminals/proof/terminate",
    (route) => {
      stopped = true;
      terminations += 1;
      return route.fulfill({
        json: { status: "terminated", terminalId: "proof", terminals: { data: [] } },
      });
    },
  );
  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("tab", { name: "上下文", exact: true }).click();
  const stop = page.getByRole("button", { name: `停止终端 ${command}`, exact: true });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect.poll(() => terminations).toBe(1);
  await expect(stop).toHaveCount(0);
});
