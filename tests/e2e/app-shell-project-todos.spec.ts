import { expect, mockAppShellApi, test } from "./fixtures/app-shell.js";

test("imports existing browser todos once and preserves their backup", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "codexly:project-todos:v1:codexly",
      JSON.stringify({ todos: [{ id: "browser-todo" }] }),
    );
    localStorage.setItem(
      "codexly:project-todo:v1:codexly:browser-todo",
      JSON.stringify({
        draft: { content: [{ type: "text", text: "浏览器旧待办" }], attachments: [] },
      }),
    );
  });
  await page.route("**/v1/projects/codexly/todos**", (route) => route.continue());
  await page.goto("/p/codexly");
  await expect(page.getByRole("button", { name: "待办 1" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("codexly:project-todo:v1:codexly:browser-todo:imported"),
      ),
    )
    .toBe("1");
  await page.reload();
  await page.getByRole("button", { name: "待办 1" }).click();
  await expect(page.getByText("浏览器旧待办", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("codexly:project-todo:v1:codexly:browser-todo")),
  ).not.toBeNull();
  await page.getByRole("button", { name: "删除待办：浏览器旧待办" }).click();
  await expect(page.getByText("浏览器旧待办", { exact: true })).toHaveCount(0);
});

test("restores server todos after reload and in an independent browser context", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.route("**/v1/projects/codexly/todos**", (route) => route.continue());
  await page.goto("/p/codexly");
  const text = `持久待办 ${String(Date.now())}`;
  await page.getByRole("textbox", { name: "任务输入" }).fill(text);
  await page.getByRole("button", { name: "保存为待办", exact: true }).click();
  await expect(page.getByRole("button", { name: "待办 1" })).toBeVisible();
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "待办 1" })).toBeVisible();

  const other = await browser.newContext({ baseURL: baseURL ?? page.url(), locale: "zh-CN" });
  try {
    const secondPage = await other.newPage();
    await mockAppShellApi(secondPage);
    await secondPage.route("**/v1/projects/codexly/todos**", (route) => route.continue());
    await secondPage.goto("/p/codexly");
    await secondPage.getByRole("button", { name: "待办 1" }).click();
    await expect(secondPage.getByText(text, { exact: true })).toBeVisible();
    await secondPage.getByRole("button", { name: `删除待办：${text}` }).click();
    await expect(secondPage.getByText(text, { exact: true })).toHaveCount(0);
  } finally {
    await other.close();
  }
});
