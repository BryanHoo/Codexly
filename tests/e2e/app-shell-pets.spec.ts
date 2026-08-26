import { expect, test, workbenchPet } from "./fixtures/app-shell.js";

test("saves pet settings without waiting for the asset download", async ({ page }) => {
  const petRequests: string[] = [];
  let releaseDownload: (() => void) | undefined;
  const downloadReleased = new Promise<void>((resolve) => {
    releaseDownload = resolve;
  });
  await page.route("**/v1/pets/downloads", async (route) => {
    await downloadReleased;
    await route.fulfill({
      contentType: "application/json",
      json: { data: { ...workbenchPet, availability: "ready" } },
    });
  });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/v1/pets/downloads" || path === "/v1/settings") {
      petRequests.push(`${request.method()} ${path}`);
    }
  });

  await page.goto("/p/codexly/t/task-1");
  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "全局设置" });
  await dialog.getByRole("button", { name: "工作台宠物" }).click();
  await dialog.getByRole("checkbox", { name: "启用工作台宠物" }).click();
  await expect.poll(() => petRequests).toContain("POST /v1/pets/downloads");

  const save = dialog.getByRole("button", { name: "保存全局默认" });
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => petRequests).toContain("PUT /v1/settings");
  await expect(dialog).toHaveCount(0);
  releaseDownload?.();
});

test("downloads, renders, moves, and restores the workbench pet", async ({ page }) => {
  const petRequests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/v1/pets")) petRequests.push(`${request.method()} ${path}`);
  });

  await page.goto("/p/codexly/t/task-1");
  expect(petRequests).toEqual([]);
  await expect(page.locator(".workbench-pet-layer")).toHaveCount(0);

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "全局设置" });
  await dialog.getByRole("button", { name: "工作台宠物" }).click();
  await expect.poll(() => petRequests).toContain("GET /v1/pets");
  await expect.poll(() => petRequests).toContain("POST /v1/pets/downloads");
  await expect(dialog.getByText("已就绪")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Codex/u }).locator("canvas")).toHaveCount(1);
  await dialog.getByRole("checkbox", { name: "启用工作台宠物" }).click();
  await dialog.getByRole("button", { name: "保存全局默认" }).click();

  const pet = page.getByRole("button", { name: "移动工作台宠物 Codex" });
  await expect(pet).toBeVisible();
  await expect(pet.locator("canvas")).toHaveCount(1);
  await expect
    .poll(() => petRequests.some((request) => request.startsWith("GET /v1/pets/assets/")))
    .toBe(true);

  const before = await pet.boundingBox();
  if (before === null) throw new Error("宠物缺少拖动边界");
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x - 120, before.y - 90, { steps: 8 });
  await page.mouse.up();
  const moved = await pet.boundingBox();
  if (moved === null) throw new Error("拖动后宠物缺少边界");
  expect(moved.x).toBeLessThan(before.x - 80);
  expect(moved.y).toBeLessThan(before.y - 50);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("codexly.workbench-pet-position")))
    .not.toBeNull();

  await page.reload();
  const restored = await pet.boundingBox();
  if (restored === null) throw new Error("刷新后宠物缺少边界");
  expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(restored.y - moved.y)).toBeLessThanOrEqual(2);

  await page.getByRole("button", { exact: true, name: "设置" }).click();
  const reopenedDialog = page.getByRole("dialog", { name: "全局设置" });
  const layerZIndex = Number(
    await page
      .locator(".workbench-pet-layer")
      .evaluate((element) => getComputedStyle(element).zIndex),
  );
  const dialogZIndex = Number(
    await reopenedDialog.evaluate((element) => getComputedStyle(element).zIndex),
  );
  expect(dialogZIndex).toBeGreaterThan(layerZIndex);
  await reopenedDialog.getByRole("button", { name: "关闭全局设置" }).click();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(pet).toBeVisible();
  await expect(pet.locator("canvas")).toHaveCount(1);
});
