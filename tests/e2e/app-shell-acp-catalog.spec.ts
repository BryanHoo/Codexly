import type { AcpAgentCatalogPage, AcpAgentCatalogProgress } from "@codexly/protocol";
import { expect, test } from "./fixtures/app-shell.js";

test("Web ACP 目录显示真实安装进度并支持确认移除 @cross-browser", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const gemini: AcpAgentCatalogPage["agents"][number] = {
    engine: "acp-gemini",
    name: "Gemini CLI",
    description: "",
    version: "1.0.0",
    detected: false,
    installed: false,
    enabled: false,
    environmentKeys: [],
  };
  const release = Promise.withResolvers<undefined>();
  let progress: AcpAgentCatalogProgress = { operations: [] };
  let removalCount = 0;
  await page.route("**/v1/capabilities", (route) =>
    route.fulfill({
      json: {
        runtime: "acp",
        provider: "codex",
        feedback: { upload: false },
        goals: { clear: false, read: false, update: false },
        skills: { list: false, use: false },
        tasks: { fork: false, list: true, read: true, start: true },
        turns: { compact: false, interrupt: false, review: false, start: true, steer: false },
      },
    }),
  );
  await page.route("**/v1/acp/registry", (route) => route.fulfill({ json: { agents: [gemini] } }));
  await page.route("**/v1/acp/registry/progress", (route) => route.fulfill({ json: progress }));
  await page.route("**/v1/acp/registry/install", async (route) => {
    // 安装请求保持进行中，确保百分比确实通过独立进度接口更新。
    progress = {
      operations: [
        {
          engine: gemini.engine,
          name: gemini.name,
          action: "install",
          progress: { stage: "downloading", received: 30, total: 100 },
        },
      ],
    };
    await release.promise;
    progress = { operations: [] };
    await route.fulfill({
      json: { agents: [{ ...gemini, installed: true, enabled: false, command: "/bin/gemini" }] },
    });
  });
  await page.route("**/v1/acp/registry/remove", async (route) => {
    removalCount += 1;
    await route.fulfill({ json: { agents: [gemini] } });
  });
  await page.goto("/p/codexly");
  await page.getByRole("button", { name: "展开项目侧栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("region", { name: "全局设置" });
  await settings.getByRole("button", { name: "ACP", exact: true }).click();
  await settings.getByRole("button", { name: "添加 Agent", exact: true }).click();
  await page.getByRole("button", { name: "安装", exact: true }).click();
  try {
    await expect(page.getByRole("progressbar", { name: "正在下载安装包" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
  } finally {
    release.resolve(undefined);
  }
  await settings.getByRole("button", { name: "移除 Agent" }).click();
  expect(removalCount).toBe(0);
  await page
    .getByRole("dialog", { name: "移除 Gemini CLI？" })
    .getByRole("button", { name: "移除", exact: true })
    .click();
  await expect(settings.getByRole("button", { name: "Gemini CLI", exact: true })).toHaveCount(0);
  expect(removalCount).toBe(1);
});
