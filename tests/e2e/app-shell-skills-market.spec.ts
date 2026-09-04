import { expect, test } from "./fixtures/app-shell.js";

const summary = {
  canonicalUrl: "https://clawhub.ai/codex/skills/review",
  displayName: "Code Review",
  downloads: 1_200,
  id: "codex/review",
  latestVersion: "1.2.0",
  owner: "codex",
  slug: "review",
  stars: 18,
  summary: "Review changes before merging.",
  topics: ["review"],
  updatedAt: 1_788_000_000_000,
  versionCount: 3,
};

test("manages installed Skills, ClawHub installs, and MCP servers", async ({ page }) => {
  const mutations: { body: unknown; method: string; path: string }[] = [];
  await page.route("**/v1/skills/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON() as unknown;
    if (request.method() !== "GET") {
      mutations.push({ body, method: request.method(), path: url.pathname });
    }
    let json: unknown;
    if (url.pathname === "/v1/skills/installed") {
      json = {
        data: [
          {
            description: "Review local changes.",
            displayName: "Local Review",
            enabled: true,
            id: "/workspace/Codexly/.agents/skills/review/SKILL.md",
            name: "review",
            path: "/workspace/Codexly/.agents/skills/review/SKILL.md",
            projectId: "codexly",
            projectName: "Codexly",
            rootPath: "/workspace/Codexly",
            scope: "repo",
            source: "local",
          },
        ],
        nextCursor: null,
      };
    } else if (url.pathname === "/v1/skills/enabled") {
      json = { effectiveEnabled: false };
    } else if (url.pathname === "/v1/skills/open") {
      json = { status: "opened" };
    } else if (url.pathname === "/v1/skills/market") {
      json = { items: [summary], nextCursor: null };
    } else if (url.pathname === "/v1/skills/market/codex/review/install") {
      json = {
        path: "/workspace/Codexly/.agents/skills/review",
        status: "installed",
        version: "1.2.0",
      };
    } else {
      json = {
        ...summary,
        changelog: "Improve review.",
        hasWarnings: false,
        readme: "---\nname: review\ndescription: Review changes.\n---\n",
        scanStatus: "clean",
        versions: [{ changelog: "Initial", createdAt: 1, version: "1.2.0" }],
      };
    }
    await route.fulfill({ contentType: "application/json", json });
  });
  await page.route("**/v1/mcp-servers/configured**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "PUT") {
      mutations.push({ body: request.postDataJSON(), method: "PUT", path });
      await route.fulfill({ contentType: "application/json", json: { enabled: false } });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      json: { data: [{ enabled: true, name: "docs" }] },
    });
  });

  await page.goto("/p/codexly");
  await page.getByRole("link", { name: "Skills & MCP" }).click();
  await expect(page).toHaveURL(/\/p\/codexly\/skills$/u);
  await expect(page.getByRole("heading", { level: 2, name: "Skills & MCP" })).toBeVisible();
  await expect(page.getByText("Local Review", { exact: true })).toBeVisible();

  await page.getByRole("switch", { name: "启用或停用 Local Review" }).click();
  await page.getByRole("button", { name: "在文件管理器中显示 Local Review" }).click();
  await page.getByRole("tab", { name: "市场" }).click();
  await expect(page.locator(".skills-market-toolbar--sticky")).toHaveCSS("position", "sticky");
  await page.getByRole("button", { name: /Code Review/u }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Review changes.");
  await dialog.getByRole("button", { name: "安装到项目" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("tab", { name: "MCP" }).click();
  await expect(page.getByText("docs", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "启用或停止 docs" }).click();

  expect(mutations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        body: { enabled: false, path: "/workspace/Codexly/.agents/skills/review/SKILL.md" },
        method: "PUT",
        path: "/v1/skills/enabled",
      }),
      expect.objectContaining({
        body: { path: "/workspace/Codexly/.agents/skills/review/SKILL.md" },
        method: "POST",
        path: "/v1/skills/open",
      }),
      expect.objectContaining({
        body: { projectId: "codexly", rootPath: "/workspace/Codexly", scope: "project" },
        method: "POST",
        path: "/v1/skills/market/codex/review/install",
      }),
      expect.objectContaining({
        body: { enabled: false },
        method: "PUT",
        path: "/v1/mcp-servers/configured/docs/enabled",
      }),
    ]),
  );
});
