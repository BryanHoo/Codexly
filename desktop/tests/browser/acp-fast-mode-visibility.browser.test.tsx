import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcpComposerLeading } from "@codexly/ui/core/acp-model-selector";
import {
  AcpDefaultSettings,
  acpDefaultSettingsLabels,
} from "@codexly/ui/core/acp-default-settings";
import type { AcpAgentProfile, AcpConfigOption } from "@codexly/protocol";
import {
  SettingsField,
  SettingsSelect,
} from "../../src/features/settings/components/global-settings-fields.js";
import "../../src/shared/styles/globals.css";
const fast: AcpConfigOption = {
  id: "fast-mode",
  name: "Fast mode",
  type: "boolean",
  currentValue: false,
};
it("API Key 登录时聊天与设置均隐藏快速模式，即使 Agent 公布该选项", async () => {
  const query = new QueryClient();
  const client = {
    getAcpAgent: vi.fn(async (): Promise<AcpAgentProfile> => ({
      engine: "codex",
      protocolVersion: 2,
      authMethods: [],
      authStatus: { kind: "api_key", label: "API key" },
    })),
    getAcpDefaults: vi.fn(async () => ({
      configOptions: [fast],
      defaults: {},
      unmappedLegacy: [],
      invalidDefaults: [],
    })),
    setAcpDefaultConfig: vi.fn(),
  };
  const screen = await render(
    <QueryClientProvider client={query}>
      <AcpComposerLeading
        options={[fast]}
        disabled={false}
        error={null}
        label="配置"
        onChange={vi.fn()}
      />
      <AcpDefaultSettings
        engine="codex"
        client={client}
        Field={SettingsField}
        Select={SettingsSelect}
        labels={acpDefaultSettingsLabels["zh-CN"]}
        language="zh-CN"
      />
    </QueryClientProvider>,
  );
  await expect.poll(() => client.getAcpDefaults.mock.calls.length).toBe(1);
  await expect
    .element(screen.getByRole("button", { name: "快速模式", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("switch", { name: "快速模式", exact: true }))
    .not.toBeInTheDocument();
  await screen.unmount();
  query.clear();
});

const base: AcpAgentProfile = { engine: "codex", protocolVersion: 2, authMethods: [] };
const cases: { name: string; profile: AcpAgentProfile; visible: boolean }[] = [
  {
    name: "官方 ChatGPT",
    profile: { ...base, authStatus: { kind: "account", label: "ChatGPT" } },
    visible: true,
  },
  {
    name: "API Key",
    profile: { ...base, authStatus: { kind: "api_key", label: "API key" } },
    visible: false,
  },
  {
    name: "网关",
    profile: { ...base, authStatus: { kind: "gateway", label: "Gateway" } },
    visible: false,
  },
  {
    name: "外部凭据",
    profile: { ...base, authStatus: { kind: "external", label: "External" } },
    visible: false,
  },
  {
    name: "未登录",
    profile: { ...base, authStatus: { kind: "none", label: "None" } },
    visible: false,
  },
  { name: "身份未知", profile: base, visible: false },
  {
    name: "ChatGPT 账号但应用自定义 API 生效",
    profile: {
      ...base,
      authStatus: { kind: "account", label: "ChatGPT" },
      connection: {
        source: "application",
        apiType: "openai",
        hasCredentials: true,
        providerId: "custom",
      },
    },
    visible: false,
  },
  {
    name: "ChatGPT 账号但本机 API 配置生效",
    profile: {
      ...base,
      authStatus: { kind: "account", label: "ChatGPT" },
      connection: {
        source: "native",
        apiType: "openai",
        hasCredentials: false,
        baseUrl: "https://api.example.test",
      },
    },
    visible: false,
  },
  {
    name: "Claude 账号",
    profile: { ...base, engine: "claude", authStatus: { kind: "account", label: "Claude" } },
    visible: false,
  },
];
it.each(cases)("$name：聊天与设置共用快速模式可见性", async ({ profile, visible }) => {
  const query = new QueryClient();
  const client = {
    getAcpAgent: vi.fn(async () => profile),
    getAcpDefaults: vi.fn(async () => ({
      configOptions: [fast],
      defaults: {},
      unmappedLegacy: [],
      invalidDefaults: [],
    })),
    setAcpDefaultConfig: vi.fn(),
  };
  const change = vi.fn();
  const screen = await render(
    <QueryClientProvider client={query}>
      <AcpComposerLeading
        engine={profile.engine}
        client={client}
        options={[fast]}
        disabled={false}
        error={null}
        label="配置"
        onChange={change}
      />
      <AcpDefaultSettings
        engine={profile.engine}
        client={client}
        Field={SettingsField}
        Select={SettingsSelect}
        labels={acpDefaultSettingsLabels["zh-CN"]}
        language="zh-CN"
      />
    </QueryClientProvider>,
  );
  await expect
    .poll(() => query.getQueryState(["acp-defaults", profile.engine])?.status)
    .toBe("success");
  await expect
    .poll(() =>
      profile.engine === "codex"
        ? query.getQueryState(["acp-agent-profile", "codex"])?.status
        : "success",
    )
    .toBe("success");
  const button = screen.getByRole("button", { name: "快速模式", exact: true });
  const setting = screen.getByRole("switch", { name: "快速模式", exact: true });
  await expect
    .poll(
      () =>
        document.querySelector('[data-acp-configuration] button[aria-label="快速模式"]') !== null,
    )
    .toBe(visible);
  await expect
    .poll(() => document.querySelector('[role="switch"][aria-label="快速模式"]') !== null)
    .toBe(visible);
  query.setQueryData(["acp-agent-profile", "codex"], {
    ...base,
    authStatus: { kind: "api_key", label: "API key" },
  });
  await expect.element(button).not.toBeInTheDocument();
  await expect.element(setting).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
  expect(client.setAcpDefaultConfig).not.toHaveBeenCalled();
  expect(client.getAcpAgent).toHaveBeenCalledTimes(profile.engine === "codex" ? 1 : 0);
  await screen.unmount();
  query.clear();
});
