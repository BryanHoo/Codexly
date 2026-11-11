import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentEngine } from "@codexly/protocol";
import { GlobalSettingsPage as WebPage } from "../../../apps/web/src/features/settings/components/global-settings-page.js";
import type { SettingsClient } from "../../../apps/web/src/features/settings/components/global-settings-page-contracts.js";
import { GlobalSettingsPage as NativePage } from "../../src/features/settings/components/global-settings-page.js";
import { nativeClient } from "../../src/features/projects/project-queries.js";
import { changeAppLanguage as changeWebLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as changeDesktopLanguage } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";

vi.mock("../../../apps/web/src/features/provider-connection/components/provider-connection-panel.js", () => ({ ProviderConnectionPanel: () => <div>旧连接入口</div> }));
vi.mock("../../../apps/web/src/features/settings/components/claude-settings-panel.js", () => ({ ClaudeSettingsPanel: () => <div>旧连接入口</div> }));
vi.mock("../../src/features/provider-connection/components/provider-connection-panel.js", () => ({ ProviderConnectionPanel: () => <div>旧连接入口</div> }));
vi.mock("../../src/features/settings/components/claude-settings-panel.js", () => ({ ClaudeSettingsPanel: () => <div>旧连接入口</div> }));

for (const platform of ["web", "desktop"] as const) {
  it.each(["codex", "claude"] as const)(`${platform}：按智能体公布的方法认证 %s`, async (engine) => {
    await Promise.all([changeWebLanguage("zh-CN"), changeDesktopLanguage("zh-CN")]);
    const inspect = vi.fn(async (requested: AgentEngine) => ({
      engine: requested, protocolVersion: 1,
      authMethods: [
        { id: "agent-selected", name: "智能体登录" },
        { id: "interactive", name: "终端登录", type: "terminal" as const },
      ],
    }));
    const authenticate = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({});
    const legacy = vi.fn();
    const client = { getAcpAgent: inspect, authenticateAcpAgent: authenticate, getEngineProfile: legacy };
    const spies = platform === "desktop" ? [
      vi.spyOn(nativeClient, "getAcpAgent").mockImplementation(inspect),
      vi.spyOn(nativeClient, "authenticateAcpAgent").mockImplementation(authenticate),
      vi.spyOn(nativeClient, "getEngineProfile").mockImplementation(legacy),
    ] : [];
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const otherEngine = engine === "codex" ? "claude" : "codex";
    query.setQueryData(["acp-defaults", engine], { cached: true });
    query.setQueryData(["acp-defaults", otherEngine], { cached: true });
    const props = {
      agentRuntime: "acp" as const, apps: [], models: [], error: null, isPending: false,
      initialSection: engine === "codex" ? "provider" as const : "claude-provider" as const,
      onClose: vi.fn(), onRetry: vi.fn(), onSave: vi.fn(),
    };
    const view = (agentRuntime: "pending" | "legacy" | "acp") => (
      <QueryClientProvider client={query}>
        {platform === "web" ? <WebPage {...props} agentRuntime={agentRuntime} client={client as unknown as SettingsClient} /> : <NativePage {...props} agentRuntime={agentRuntime} />}
      </QueryClientProvider>
    );
    const screen = await render(view("pending"));
    try {
      expect(inspect).not.toHaveBeenCalled();
      await screen.rerender(view("acp"));
      await expect.element(screen.getByText("旧连接入口", { exact: true })).not.toBeInTheDocument();
      const login = screen.getByRole("button", { name: "智能体登录", exact: true });
      await expect.element(login).toBeEnabled();
      await expect.element(screen.getByRole("button", { name: "终端登录", exact: true })).toBeDisabled();
      expect(inspect.mock.calls[0]?.[0]).toBe(engine);
      expect(authenticate).not.toHaveBeenCalled();
      await expect.element(screen.getByRole("heading", { name: "供应商配置", exact: true })).not.toBeInTheDocument();
      await login.click();
      await expect.element(screen.getByRole("alert")).toHaveTextContent("认证失败");
      await login.click();
      await expect.element(screen.getByText("认证请求已完成。", { exact: true })).toBeVisible();
      expect(authenticate.mock.calls.map((call) => call.slice(0, 2))).toEqual([[engine, "agent-selected"], [engine, "agent-selected"]]);
      expect(authenticate.mock.calls[0]?.[2]?.idempotencyKey).toBe(authenticate.mock.calls[1]?.[2]?.idempotencyKey);
      expect(query.getQueryState(["acp-defaults", engine])?.isInvalidated).toBe(true);
      expect(query.getQueryState(["acp-defaults", otherEngine])?.isInvalidated).toBe(false);
      let finish!: (receipt: Record<string, never>) => void;
      authenticate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      await login.click();
      await expect.element(login).toBeDisabled();
      const inFlight = authenticate.mock.calls[2]?.[2];
      await screen.rerender(view("legacy"));
      await expect.element(screen.getByText("旧连接入口", { exact: true })).toBeVisible();
      expect(inFlight?.signal.aborted).toBe(true);
      finish({});
      await screen.rerender(view("acp"));
      await expect.element(login).toBeEnabled();
      await expect.element(screen.getByText("认证请求已完成。", { exact: true })).not.toBeInTheDocument();
      expect(authenticate).toHaveBeenCalledTimes(3);
      expect(legacy).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      query.clear();
      spies.forEach((spy) => spy.mockRestore());
    }
  });
}

for (const platform of ["web", "desktop"] as const) {
  it(`${platform}：仅公布能力时读取供应商，并显式替换请求头`, async () => {
    await Promise.all([changeWebLanguage("zh-CN"), changeDesktopLanguage("zh-CN")]);
    const current = { apiType: "native-protocol", baseUrl: "https://previous.example" };
    const main = { providerId: "main", required: true, supported: ["native-protocol"], current };
    const gateway = { ...main, providerId: "gateway", required: false };
    const inspect = vi.fn(async () => ({ engine: "codex" as const, protocolVersion: 1, authMethods: [], providerConfiguration: true as const }));
    const list = vi.fn(async () => ({ providers: [main, gateway], restartRequired: false }));
    const configure = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({
      providers: [main, { ...gateway, current: { ...current, baseUrl: "https://new.example" } }],
      restartRequired: true,
    });
    const disable = vi.fn(async () => ({ providers: [main, { ...gateway, current: null }], restartRequired: true }));
    const client = { getAcpAgent: inspect, authenticateAcpAgent: async () => ({}), getAcpProviders: list, configureAcpProvider: configure, disableAcpProvider: disable };
    const spies = platform === "desktop" ? [
      vi.spyOn(nativeClient, "getAcpAgent").mockImplementation(inspect),
      vi.spyOn(nativeClient, "authenticateAcpAgent").mockImplementation(client.authenticateAcpAgent),
      vi.spyOn(nativeClient, "getAcpProviders").mockImplementation(list),
      vi.spyOn(nativeClient, "configureAcpProvider").mockImplementation(configure),
      vi.spyOn(nativeClient, "disableAcpProvider").mockImplementation(disable),
    ] : [];
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = { agentRuntime: "acp" as const, apps: [], models: [], error: null, isPending: false, initialSection: "provider" as const, onClose: vi.fn(), onRetry: vi.fn(), onSave: vi.fn() };
    const screen = await render(<QueryClientProvider client={query}>
      {platform === "web" ? <WebPage {...props} client={client as unknown as SettingsClient} /> : <NativePage {...props} />}
    </QueryClientProvider>);
    try {
      const row = screen.getByRole("group", { name: "gateway", exact: true });
      await expect.element(row.getByText("https://previous.example", { exact: true })).toBeVisible({ timeout: 3000 });
      await expect.element(screen.getByRole("group", { name: "main", exact: true }).getByRole("button", { name: "停用", exact: true })).not.toBeInTheDocument();
      await row.getByRole("button", { name: "编辑", exact: true }).click();
      await row.getByRole("textbox", { name: "服务地址", exact: true }).fill("https://new.example");
      const save = row.getByRole("button", { name: "保存", exact: true });
      await expect.element(save).toBeDisabled();
      await row.getByRole("button", { name: "添加请求头", exact: true }).click();
      await row.getByLabelText("请求头名称").fill("Authorization");
      await row.getByLabelText("请求头值").fill("fixture-only-secret");
      await row.getByRole("checkbox", { name: "替换现有配置和请求头" }).click();
      await save.click();
      await expect.element(row.getByRole("alert")).toHaveTextContent("保存失败");
      await save.click();
      await expect.element(row.getByText("https://new.example", { exact: true })).toBeVisible();
      expect(configure.mock.calls[0]?.[1]).toEqual({ providerId: "gateway", apiType: "native-protocol", baseUrl: "https://new.example", headers: { Authorization: "fixture-only-secret" } });
      expect(configure.mock.calls[1]?.[2]?.idempotencyKey).toBe(configure.mock.calls[0]?.[2]?.idempotencyKey);
      expect(JSON.stringify(query.getQueryData(["acp-providers", "codex"]))).not.toContain("fixture-only-secret");
      await expect.element(row.getByLabelText("请求头值")).not.toBeInTheDocument();
      await row.getByRole("button", { name: "停用", exact: true }).click();
      expect(disable).not.toHaveBeenCalled();
      await row.getByRole("button", { name: "确认停用", exact: true }).click();
      await expect.element(row.getByText("已停用", { exact: true })).toBeVisible();
      expect(disable.mock.calls).toHaveLength(1);
      expect(props.onSave).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
      query.clear();
      spies.forEach((spy) => spy.mockRestore());
    }
  });
}
