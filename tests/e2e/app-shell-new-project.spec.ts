import { expect, projects, test } from "./fixtures/app-shell.js";

for (const width of [390, 1280]) {
  test(`creates a project and retries registration without recreating at ${String(width)}px @cross-browser`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    // 局域网 HTTP 上没有 randomUUID，创建仍应使用现有 UUID 回退实现。
    await page.addInitScript(() =>
      Object.defineProperty(crypto, "randomUUID", { value: undefined }),
    );
    let creates = 0;
    let adds = 0;
    await page.route("**/v1/project-directories**", async (route) => {
      if (route.request().method() === "POST") {
        creates++;
        expect(route.request().postDataJSON()).toEqual({
          parentPath: "/workspace/projects",
          name: "my-app",
        });
        await route.fulfill({ json: { path: "/workspace/projects/my-app", status: "created" } });
      } else {
        const path = new URL(route.request().url()).searchParams.get("path") ?? "/workspace";
        await route.fulfill({
          json: {
            path,
            parentPath: "/",
            roots: [],
            entries: [{ path: "/workspace/projects", name: "projects" }],
          },
        });
      }
    });
    await page.route("**/v1/projects", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      adds++;
      if (adds === 1)
        return route.fulfill({
          status: 502,
          json: { code: "PROVIDER_ERROR", message: "Registration failed", retryable: false },
        });
      const project = {
        ...projects[0],
        id: "my-app",
        name: "my-app",
        roots: [{ id: "root-new", path: "/workspace/projects/my-app" }],
      };
      await route.fulfill({
        json: { project, projects: { data: [...projects, project], nextCursor: null } },
      });
    });
    await page.goto("/p/codexly");
    if (width < 768) await page.getByRole("button", { name: "展开项目侧栏" }).click();
    await page.getByRole("button", { name: "添加项目", exact: true }).click();
    await page.getByRole("menuitem", { name: "新建项目" }).click();
    const form = page.getByRole("dialog", { name: "新建项目", exact: true });
    await form.getByRole("textbox", { name: "文件夹名称" }).fill("../invalid");
    await expect(form.getByRole("button", { name: "创建并添加" })).toBeDisabled();
    await form.getByRole("textbox", { name: "文件夹名称" }).fill("my-app");
    await form.getByRole("button", { name: "选择…" }).click();
    const picker = page.getByRole("dialog", { name: "选择父文件夹" });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await picker.getByRole("radio", { name: "选择 projects", exact: true }).check();
    await picker.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`parent-picker-${String(width)}.png`),
    });
    await picker.getByRole("button", { name: "使用此文件夹" }).click();
    await expect(form.getByRole("textbox", { name: "文件夹名称" })).toHaveValue("my-app");
    await expect(form).toContainText("/workspace/projects/my-app");
    expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`new-project-${String(width)}.png`),
    });
    await form.getByRole("button", { name: "创建并添加" }).click();
    await expect(form.getByRole("alert")).toContainText("添加项目失败");
    await form.getByRole("button", { name: "重试添加" }).click();
    await expect(form).toBeHidden();
    await expect(page).toHaveURL(/\/p\/my-app$/u);
    expect(creates).toBe(1);
    expect(adds).toBe(2);
  });
}
