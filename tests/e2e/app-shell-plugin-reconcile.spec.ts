import { expect, test } from "./fixtures/app-shell.js";

test("synchronizes official plugin state on mobile @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let synchronized = false;
  let syncCount = 0;
  await page.route("**/v1/plugins/official**", async (route) => {
    const request = route.request();
    if (new URL(request.url()).pathname.endsWith("/reconcile")) {
      expect(request.method()).toBe("POST");
      synchronized = true;
      syncCount += 1;
      await route.fulfill({
        json: {
          changedPlugins: [
            {
              id: "github@remote",
              hasApps: true,
              hasHooks: false,
              hasMcps: true,
              hasSkills: false,
            },
          ],
          failedRemotePluginIds: [],
          failedMaterializationRemotePluginIds: [],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        data: [
          {
            authPolicy: "ON_USE",
            availability: "AVAILABLE",
            description: "Repository tools",
            developerName: "OpenAI",
            disabledReason: null,
            displayName: "GitHub",
            enabled: synchronized,
            id: "github@remote",
            installPolicy: "AVAILABLE",
            installed: synchronized,
            localVersion: synchronized ? "1.0.0" : null,
            logoUrl: null,
            marketplaceName: "openai-curated-remote",
            marketplacePath: null,
            name: "github",
            pluginName: "remote-github",
            version: "1.0.0",
          },
        ],
      },
    });
  });
  await page.goto("/p/codexly/extensions/plugins");
  await expect(page.getByRole("button", { name: /GitHub/u })).toBeVisible();
  expect(syncCount).toBe(0);
  await page.getByRole("button", { name: "刷新官方插件" }).click();
  await expect(page.getByRole("button", { name: /GitHub/u })).toContainText("已安装");
  expect(syncCount).toBe(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
