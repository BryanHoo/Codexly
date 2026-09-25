import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import "../../shared/styles/globals.css";
import "../../shared/styles/skills-market.css";
import "../../shared/styles/official-plugins.css";

import { I18nextProvider, i18n } from "../../i18n/i18n.js";
import { createActionMutationCache } from "../notifications/action-notifications.js";
import { SkillsMarketContainer } from "./skills-market-container.js";

const mocks = vi.hoisted(() => ({
  getClawhubSkill: vi.fn(),
  installClawhubSkill: vi.fn(),
  listClawhubSkills: vi.fn(),
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

const summary = {
  canonicalUrl: "https://clawhub.ai/codex/skills/review",
  displayName: "Code Review",
  downloads: 1200,
  id: "codex/review",
  latestVersion: "1.2.0",
  owner: "codex",
  slug: "review",
  stars: 18,
  summary: "Review changes before merging.",
  topics: ["review"],
  updatedAt: 1_788_000_000_000,
  versionCount: 3,
} as const;

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
        <SkillsMarketContainer projectId="project-a" rootPath="/work" />
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
          marketplace: { installedVersion: "1.0.0", owner: "codex", slug: "review" },
          name: "review",
          path: "/work/.agents/skills/review/SKILL.md",
          projectId: "project-a",
          projectName: "Project A",
          rootPath: "/work",
          scope: "repo",
          source: "clawhub",
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
    mocks.listClawhubSkills.mockResolvedValue({ items: [summary], nextCursor: null });
    mocks.getClawhubSkill.mockResolvedValue({
      ...summary,
      changelog: "Improve review.",
      hasWarnings: false,
      readme: "---\nname: review\ndescription: Review changes.\n---\n",
      scanStatus: "clean",
      versions: [{ changelog: "Initial", createdAt: 1, version: "1.2.0" }],
    });
    mocks.installClawhubSkill.mockResolvedValue({
      path: "/work/.agents/skills/review",
      status: "updated",
      version: "1.2.0",
    });
  });

  it("opens installed skills and installs into a selected sidebar project", async () => {
    const screen = await renderMarket();
    await expect.element(screen.getByRole("heading", { name: "扩展中心" })).toBeVisible();
    expect(screen.container.querySelector(".extension-center__mark")).toBeNull();
    await expect.element(screen.getByText("Local Review")).toBeVisible();
    await expect.element(screen.getByText("Project Lint")).toBeVisible();
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
    mocks.toastSuccess.mockClear();

    await screen.getByRole("tab", { name: "三方市场" }).click();
    await screen.getByRole("button", { name: /Code Review/ }).click();
    await expect.element(screen.getByRole("dialog")).toBeVisible();
    expect(document.querySelector("[data-slot='sheet-content'].third-party-skill-sheet"))
      .not.toBeNull();
    expect(document.querySelector("[data-slot='dialog-content']")).toBeNull();
    await page.screenshot({ path: "../../../test-results/extension-center-third-party-sheet.png" });
    const projectSelect = screen.getByRole("combobox", { name: "安装项目" });
    const projectSelectElement = projectSelect.element();
    await projectSelect.click();
    await screen.getByRole("option", { name: "Project B" }).click();
    const projectInstallButton = screen.getByRole("button", { name: "安装到项目" });
    const globalInstallButton = screen.getByRole("button", { name: "安装到全局" });
    await expect.element(projectInstallButton).toBeVisible();
    const projectInstallElement = projectInstallButton.element() as HTMLButtonElement;
    const globalInstallElement = globalInstallButton.element() as HTMLButtonElement;
    const installControls = [...document.querySelectorAll(
      ".skills-market-detail__footer [data-slot='select-trigger'], .skills-market-detail__footer [data-slot='button']",
    )].slice(-3);
    expect(installControls).toEqual([
      projectSelectElement,
      projectInstallElement,
      globalInstallElement,
    ]);
    expect(projectSelectElement.getBoundingClientRect().height)
      .toBe(projectInstallElement.getBoundingClientRect().height);
    expect(projectSelectElement.getBoundingClientRect().height)
      .toBe(globalInstallElement.getBoundingClientRect().height);
    expect(projectInstallElement.dataset.variant).toBe("outline");
    expect(globalInstallElement.dataset.variant).toBe("default");
    let finishInstall: (() => void) | undefined;
    mocks.installClawhubSkill.mockImplementationOnce(() => new Promise((resolve) => {
      finishInstall = () => resolve({
        path: "/work/.agents/skills/review",
        status: "updated",
        version: "1.2.0",
      });
    }));
    await screen.getByRole("button", { name: "安装到项目" }).click();
    expect(mocks.installClawhubSkill).toHaveBeenCalledWith(
      "codex",
      "review",
      "project",
      "project-b",
      "/other",
    );
    await vi.waitFor(() => {
      expect(projectInstallElement.disabled).toBe(true);
      expect(projectInstallElement.querySelector('[data-icon="loading"]')).not.toBeNull();
      expect(globalInstallElement.disabled).toBe(true);
      expect(globalInstallElement.querySelector('[data-icon="loading"]')).toBeNull();
    });
    finishInstall?.();
    await vi.waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledTimes(1);
      expect(mocks.toastSuccess).toHaveBeenCalledWith("Skill 安装完成");
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
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
