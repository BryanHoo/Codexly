import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GlobalSettingsPage as WebPage } from "../../../apps/web/src/features/settings/components/global-settings-page.js";
import { GlobalSettingsPage as NativePage } from "../../src/features/settings/components/global-settings-page.js";
import { SkillsMarketContainer as WebMarket } from "../../../apps/web/src/features/skills-market/skills-market-container.js";
import { SkillsMarketContainer as NativeMarket } from "../../src/features/skills-market/skills-market-container.js";
import { nativeClient } from "../../src/features/projects/project-queries.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import type { SettingsClient } from "../../../apps/web/src/features/settings/components/global-settings-page-contracts.js";
import "../../src/shared/styles/globals.css";

const state = vi.hoisted(() => ({
  capabilities: undefined as undefined | { runtime?: "acp" },
  calls: vi.fn(),
  listInstalledSkills: vi.fn(() => Promise.resolve({ data: [] })),
}));
vi.mock("../../../apps/web/src/features/projects/project-context.js", () => ({
  useProjectData: () => ({
    capabilities: state.capabilities,
    client: { listInstalledSkills: state.listInstalledSkills },
    projects: [],
  }),
}));
vi.mock("../../src/features/projects/project-context.js", () => ({
  useProjectData: () => ({
    capabilities: state.capabilities,
    client: { listInstalledSkills: state.listInstalledSkills },
    projects: [],
  }),
}));
beforeEach(async () => {
  await page.viewport(390, 844);
  await webLanguage("zh-CN");
  await nativeLanguage("zh-CN");
  state.calls.mockClear();
  state.listInstalledSkills.mockClear();
  for (const method of [
    "getMemorySettings",
    "listInstalledSkills",
    "listConfiguredMcpServers",
    "listOfficialPlugins",
    "listClaudeExtensions",
  ] as const)
    vi.spyOn(nativeClient, method).mockImplementation(() => {
      state.calls(method);
      return Promise.reject(new Error("不应调用旧接口"));
    });
});
afterEach(() => vi.restoreAllMocks());

for (const [platform, Page, Market] of [
  ["Web", WebPage, WebMarket],
  ["Native", NativePage, NativeMarket],
] as const) {
  it(`${platform}：ACP 个性化不读取旧指令或记忆，未知运行时保持加载`, async () => {
    // 原生设置使用真实目录端口，只有目录中已安装的 Agent 会渲染会话配置。
    vi.spyOn(nativeClient, "getAcpAgentCatalog").mockResolvedValue({
      agents: [
        {
          engine: "codex",
          name: "Codex",
          description: "",
          installed: true,
          enabled: true,
          detected: true,
          environmentKeys: [],
          command: "/bin/codex",
        },
      ],
    });
    const profile = {
      engine: "codex" as const,
      protocolVersion: 2,
      authMethods: [],
    };
    vi.spyOn(nativeClient, "getAcpAgent").mockResolvedValue(profile);
    const client = {
      getAcpAgent: () => Promise.resolve(profile),
      getGlobalInstructions: () => {
        state.calls("instructions");
        return Promise.reject(new Error("legacy"));
      },
      getMemorySettings: () => {
        state.calls("memories");
        return Promise.reject(new Error("legacy"));
      },
    } as unknown as SettingsClient;
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const screen = await render(
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <Page
            client={client}
            agentRuntime="acp"
            initialSection="personalization"
            apps={[]}
            error={null}
            isPending={false}
            models={[]}
            onClose={() => undefined}
            onRetry={() => undefined}
            onSave={() => Promise.resolve()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await expect
      .element(screen.getByRole("heading", { name: "连接配置", exact: true }))
      .toBeVisible();
    expect(state.calls).not.toHaveBeenCalled();
    await screen.rerender(
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <Page
            client={client}
            agentRuntime="pending"
            initialSection="personalization"
            apps={[]}
            error={null}
            isPending={false}
            models={[]}
            onClose={() => undefined}
            onRetry={() => undefined}
            onSave={() => Promise.resolve()}
          />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(state.calls).not.toHaveBeenCalled();
    cache.clear();
  });
  it(`${platform}：扩展中心等待能力后显示 ACP 说明，不挂载旧目录`, async () => {
    state.capabilities = undefined;
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrap = () => (
      <QueryClientProvider client={cache}>
        <TooltipProvider>
          <Market />
        </TooltipProvider>
      </QueryClientProvider>
    );
    const screen = await render(wrap());
    await expect.element(screen.getByRole("status")).toBeVisible();
    expect(state.calls).not.toHaveBeenCalled();
    state.capabilities = { runtime: "acp" };
    await screen.rerender(wrap());
    await expect
      .element(
        screen.getByText("请使用智能体自身提供的设置管理 Skills、MCP 和插件。", { exact: true }),
      )
      .toBeVisible();
    expect(state.calls).not.toHaveBeenCalled();
    expect(state.listInstalledSkills).not.toHaveBeenCalled();
    state.capabilities = {};
    await screen.rerender(wrap());
    await expect.element(screen.getByText("请使用智能体自身提供的设置管理 Skills、MCP 和插件。", { exact: true })).toBeVisible();
    expect(state.listInstalledSkills).not.toHaveBeenCalled();
    cache.clear();
  });
}
