import { LAN_PAIRING_CODE, expect, test } from "./fixtures/lan-access.js";

test("pairs real browsers, persists the cookie, and invalidates it on logout @cross-browser", async ({
  browser,
  lanServerUrl,
  page,
}) => {
  const businessRequests: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/projects")) {
      businessRequests.push(request.url());
    }
  });
  page.on("websocket", (socket) => sockets.push(socket.url()));

  await page.goto("/p/codexly/t/task-realtime");
  await expect(page.getByRole("region", { name: "Codexly" })).toContainText("连接可信局域网会话");
  expect(businessRequests).toEqual([]);
  expect(sockets).toEqual([]);

  const codeInput = page.getByRole("textbox", { name: "访问密码" });
  await expect(page.locator("#access-pairing-code")).toHaveCount(1);
  await codeInput.focus();
  await expect(codeInput).toHaveCSS("outline-style", "none");
  await codeInput.fill("wrong-pairing-code");
  await page.getByRole("button", { name: "配对" }).click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveText(
    "Pairing request failed",
  );
  await expect(page.getByRole("button", { name: "切换项目 Codexly" })).toHaveCount(0);

  await codeInput.fill(LAN_PAIRING_CODE);
  await page.getByRole("button", { name: "配对" }).click();
  await expect(page.getByRole("button", { name: "切换项目 Codexly" })).toBeVisible();
  await expect.poll(() => sockets.length).toBeGreaterThan(0);

  // 配对后的远程 Web 必须直接通过 Server API 浏览宿主目录，不依赖浏览器所在机器的原生选择器。
  const directoryListingResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/v1/project-directories" && response.request().method() === "GET";
  });
  await page.getByRole("button", { name: "添加项目" }).click();
  const projectPicker = page.getByRole("dialog", { name: "选择项目文件夹" });
  await expect(projectPicker).toBeVisible();
  expect((await directoryListingResponse).ok()).toBe(true);
  await expect(projectPicker.getByRole("tree", { name: "项目文件夹目录树" })).toBeVisible();
  const addProjectButton = projectPicker.getByRole("button", { name: "添加此文件夹" });
  await expect(addProjectButton).toBeDisabled();
  await projectPicker.getByRole("checkbox").first().click();
  await expect(addProjectButton).toBeEnabled();
  await projectPicker.getByRole("button", { name: "取消" }).click();
  await expect(projectPicker).toBeHidden();

  const cookies = await page.context().cookies(lanServerUrl);
  // SameSite 响应属性由 Server 单测直接验证；E2E 只验证各浏览器一致暴露的持久化属性。
  expect(cookies).toContainEqual(
    expect.objectContaining({
      httpOnly: true,
      name: "codexly_session",
      secure: false,
    }),
  );

  await page.reload();
  await expect(page.getByRole("button", { name: "切换项目 Codexly" })).toBeVisible();

  const otherContext = await browser.newContext({ baseURL: lanServerUrl, locale: "zh-CN" });
  try {
    const otherPage = await otherContext.newPage();
    await otherPage.goto("/");
    await expect(otherPage.getByRole("region", { name: "Codexly" })).toContainText(
      "连接可信局域网会话",
    );
  } finally {
    await otherContext.close();
  }

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "全局设置" });
  await dialog.getByRole("button", { name: "局域网访问" }).click();
  await dialog.getByRole("button", { name: "退出局域网访问" }).click();

  await expect(page.getByRole("region", { name: "Codexly" })).toContainText("连接可信局域网会话");
  await expect(page.getByRole("button", { name: "切换项目 Codexly" })).toHaveCount(0);
});
