import { expect, test } from "./fixtures/app-shell.js";

test("loads completed tasks with one aggregate request", async ({ page }) => {
  const requests: unknown[] = [];
  let perProjectRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).searchParams.get("completed") === "true") perProjectRequests++;
  });
  await page.route("**/v1/tasks/completed/query", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        data: [
          {
            id: "completed-api-task",
            projectId: "codexly",
            pinned: false,
            title: "聚合查询完成任务",
            updatedAt: "2026-09-13T00:00:00Z",
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.goto("/p/codexly/board");
  await expect(page.getByText("聚合查询完成任务", { exact: true })).toBeVisible();
  expect(requests).toEqual([{ projectIds: ["temporary", "codexly", "superwork"] }]);
  expect(perProjectRequests).toBe(0);
});
