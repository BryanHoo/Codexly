import { TooltipProvider } from "@codexly/ui/core/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import "../../shared/styles/globals.css";
import "../../shared/styles/official-plugins.css";

import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { createActionMutationCache } from "../notifications/action-notifications.js";
import { SkillsMarketContainer } from "./skills-market-container.js";

const mocks = vi.hoisted(() => ({
  listConfiguredMcpServers: vi.fn(),
  listInstalledSkills: vi.fn(),
  listOfficialPlugins: vi.fn(),
  getOfficialPlugin: vi.fn(),
  installOfficialPlugin: vi.fn(),
  uninstallOfficialPlugin: vi.fn(),
  openSkillDirectory: vi.fn(),
  setMcpServerEnabled: vi.fn(),
  setSkillEnabled: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

vi.mock("../projects/project-context.js", () => ({
  useProjectData: () => ({
    client: mocks,
    projects: [
      { createdAt: "2026-01-01T00:00:00Z", id: "project-a", name: "Project A", roots: [{ id: "root-a", path: "/work" }] },
      { createdAt: "2026-01-01T00:00:00Z", id: "project-b", name: "Project B", roots: [{ id: "root-b", path: "/other" }] },
    ],
  }),
}));

const officialPlugin = {
  authPolicy: "ON_INSTALL",
  availability: "AVAILABLE",
  description: "Connect Codex to GitHub repositories.",
  developerName: "OpenAI",
  disabledReason: null,
  displayName: "GitHub",
  enabled: false,
  id: "github@openai-api-curated",
  installPolicy: "AVAILABLE",
  installed: false,
  localVersion: null,
  logoUrl: null,
  marketplaceName: "openai-api-curated",
  marketplacePath: "/cache/api_marketplace.json",
  name: "github",
  pluginName: "github",
  version: "1.0.0",
} as const;

const installedOfficialPlugin = {
  ...officialPlugin,
  displayName: "Figma",
  enabled: true,
  id: "figma@openai-api-curated",
  installed: true,
  name: "figma",
  pluginName: "figma",
} as const;

function renderMarket() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    mutationCache: createActionMutationCache(),
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider><SkillsMarketContainer /></TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe("SkillsMarketContainer", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN");
    vi.clearAllMocks();
    mocks.listInstalledSkills.mockResolvedValue({
      data: [
        {
          description: "Review local changes.",
          displayName: "Local Review",
          enabled: true,
          id: "/work/.agents/skills/review/SKILL.md",
          name: "review",
          path: "/work/.agents/skills/review/SKILL.md",
          projectId: "project-a",
          projectName: "Project A",
          rootPath: "/work",
          scope: "repo",
          source: "local",
        },
        {
          description: "Lint another project.",
          displayName: "Project Lint",
          enabled: true,
          id: "/other/.agents/skills/lint/SKILL.md",
          name: "lint",
          path: "/other/.agents/skills/lint/SKILL.md",
          projectId: "project-b",
          projectName: "Project B",
          rootPath: "/other",
          scope: "repo",
          source: "local",
        },
        {
          description: "Global helper.",
          displayName: "Global Helper",
          enabled: true,
          id: "/global/helper/SKILL.md",
          name: "global-helper",
          path: "/global/helper/SKILL.md",
          scope: "user",
          source: "local",
        },
        {
          description: "Built-in helper.",
          displayName: "System Helper",
          enabled: true,
          id: "/system/helper/SKILL.md",
          name: "system-helper",
          path: "/system/helper/SKILL.md",
          scope: "system",
          source: "local",
        },
      ],
      nextCursor: null,
    });
    mocks.setSkillEnabled.mockResolvedValue({ effectiveEnabled: false });
    mocks.listConfiguredMcpServers.mockResolvedValue({
      data: [
        { enabled: true, name: "docs" },
        { enabled: false, name: "linear" },
      ],
    });
    mocks.setMcpServerEnabled.mockResolvedValue({ enabled: false });
    mocks.listOfficialPlugins.mockResolvedValue({
      data: [officialPlugin, installedOfficialPlugin],
    });
    mocks.getOfficialPlugin.mockResolvedValue({
      ...officialPlugin,
      apps: [{
        description: "Access GitHub repositories.",
        id: "connector_github",
        installUrl: "https://example.test/install",
        name: "GitHub",
      }],
      hooks: [],
      mcpServers: ["github"],
      skills: [{ description: "Search repositories.", name: "github-search" }],
      websiteUrl: "https://github.com",
    });
    mocks.installOfficialPlugin.mockResolvedValue({
      appsNeedingAuth: [{
        description: "Access GitHub repositories.",
        id: "connector_github",
        installUrl: "https://example.test/install",
        name: "GitHub",
      }],
      authPolicy: "ON_INSTALL",
    });
    mocks.openSkillDirectory.mockResolvedValue({ status: "opened" });

  });

  it("opens and toggles installed skills without a third-party market", async () => {
    const screen = await renderMarket();
    await expect.element(screen.getByRole("heading", { name: "扩展中心" })).toBeVisible();
    expect(screen.container.querySelector(".extension-center__mark")).toBeNull();
    await expect.element(screen.getByText("Local Review")).toBeVisible();
    await expect.element(screen.getByText("Project Lint")).toBeVisible();
    expect([...screen.container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent))
      .toEqual(["Skills 管理", "MCP 管理", "官方插件"]);
    const groupHeadings = [...screen.container.querySelectorAll(".skills-installed-group h3")]
      .map((heading) => heading.textContent);
    expect(groupHeadings).toEqual(["系统", "全局", "Project A", "Project B"]);
    expect(getComputedStyle(screen.container.querySelector(".extension-center__header")!).position)
      .toBe("sticky");
    await screen.getByRole("button", { name: /Local Review/ }).click();
    expect(mocks.openSkillDirectory).toHaveBeenCalledWith(
      "/work/.agents/skills/review/SKILL.md",
    );
    await screen.getByRole("switch", { name: "启用或停用 Local Review" }).click();
    expect(mocks.setSkillEnabled).toHaveBeenCalledWith(
      "/work/.agents/skills/review/SKILL.md",
      false,
    );

  });

  it("lists configured MCP servers and stops the selected server", async () => {
    const screen = await renderMarket();

    await screen.getByRole("tab", { name: "MCP 管理" }).click();
    await expect.element(screen.getByText("docs", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("linear", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("2 个 MCP 服务")).toBeVisible();
    const tabs = screen.container.querySelector(".skills-market-tabs")!;
    expect(tabs.scrollWidth).toBeLessThanOrEqual(tabs.clientWidth);
    await screen.getByRole("switch", { name: "启用或停止 docs" }).click();
    expect(mocks.setMcpServerEnabled).toHaveBeenCalledWith("docs", false);

    await screen.getByRole("switch", { name: "启用或停止 linear" }).click();
    expect(mocks.setMcpServerEnabled).toHaveBeenCalledWith("linear", true);
  });

  it("installs an official plugin and keeps bundled assets read-only", async () => {
    const screen = await renderMarket();

    await screen.getByRole("tab", { name: "官方插件" }).click();
    await expect.element(screen.getByRole("heading", { name: "已安装" })).toBeVisible();
    const groupHeadings = [...screen.container.querySelectorAll(".official-plugin-group h3")]
      .map((heading) => heading.textContent);
    expect(groupHeadings).toEqual(["已安装", "未安装"]);
    const cards = [...screen.container.querySelectorAll(".official-plugin-card")];
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining("Figma"),
      expect.stringContaining("GitHub"),
    ]);
    expect(cards.every((card) => card.getBoundingClientRect().height <= 120)).toBe(true);
    await screen.getByText("GitHub", { exact: true }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    await expect.element(screen.getByText("github-search")).toBeVisible();
    await expect.element(screen.getByText("github", { exact: true })).toBeVisible();
    expect(screen.container.querySelectorAll(".official-plugin-asset [role='switch']")).toHaveLength(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    const sheet = document.querySelector(".official-plugin-sheet");
    expect(sheet).not.toBeNull();
    expect(sheet!.scrollWidth).toBeLessThanOrEqual(sheet!.clientWidth);
    await page.screenshot({ path: "../../../test-results/extension-center-official-plugin.png" });

    let finishInstall: (() => void) | undefined;
    mocks.installOfficialPlugin.mockImplementationOnce(() => new Promise((resolve) => {
      finishInstall = () => resolve({ appsNeedingAuth: [], authPolicy: "ON_INSTALL" });
    }));
    const installButton = screen.getByRole("button", { name: "安装插件" });
    await installButton.click();
    await vi.waitFor(() => {
      expect(mocks.installOfficialPlugin).toHaveBeenCalledWith(
        "openai-api-curated",
        "/cache/api_marketplace.json",
        "github",
        expect.any(String),
      );
      expect((installButton.element() as HTMLButtonElement).disabled).toBe(true);
      expect(installButton.element().querySelector('[data-icon="loading"]')).not.toBeNull();
    });
    finishInstall?.();
    await expect.element(
      screen.getByText("插件已安装。请新建会话以加载插件能力。"),
    ).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "卸载插件" })).toBeVisible();
  });
});
