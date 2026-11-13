import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AcpAgentProfile, AcpProviderConfig } from "@codexly/protocol";
import { GlobalSettingsPage as WebPage } from "../../../apps/web/src/features/settings/components/global-settings-page.js";
import type { SettingsClient } from "../../../apps/web/src/features/settings/components/global-settings-page-contracts.js";
import { GlobalSettingsPage as NativePage } from "../../src/features/settings/components/global-settings-page.js";
import { nativeClient } from "../../src/features/projects/project-queries.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";

async function fixture(
  platform: "web" | "desktop",
  language: "zh-CN" | "en" = "zh-CN",
  source: "native" | "application" = "native",
) {
  await Promise.all([webLanguage(language), nativeLanguage(language)]);
  let connection: AcpAgentProfile["connection"] = {
    source,
    providerId: "openai",
    baseUrl: "https://global-custom.example/v1",
    apiType: "openai",
    hasCredentials: true,
  };
  let account: AcpAgentProfile["authStatus"] = {
    kind: "gateway",
    label: "Custom model gateway",
    detail: "OpenAI",
  };
  const page = () => ({
    providers: [
      {
        providerId: "openai",
        supported: ["openai", "openai-chat-completions"],
        required: false,
        current: {
          apiType: connection?.apiType ?? "openai",
          baseUrl: connection?.baseUrl ?? "https://api.openai.com/v1",
        },
      },
    ],
    restartRequired: false,
  });
  const client = {
    getAcpAgent: vi.fn(async (): Promise<AcpAgentProfile> => ({
      engine: "codex",
      protocolVersion: 1,
      providerConfiguration: true,
      ...(connection ? { connection } : {}),
      ...(account ? { authStatus: account } : {}),
      authMethods: [
        { id: "api-key", name: "API Key" },
        { id: "chat-gpt", name: "ChatGPT" },
      ],
    })),
    getAcpProviders: vi.fn(async () => page()),
    configureAcpProvider: vi.fn(async (_engine: string, config: AcpProviderConfig) => {
      connection = {
        source: "application",
        providerId: config.providerId,
        apiType: config.apiType,
        baseUrl: config.baseUrl,
        hasCredentials: true,
      };
      return page();
    }),
    disableAcpProvider: vi.fn(async () => {
      connection = undefined;
      return page();
    }),
    authenticateAcpAgent: vi.fn(
      async (
        _engine: string,
        method: string,
        _options?: { signal?: AbortSignal; credentials?: { apiKey?: string } },
      ) => {
        connection = undefined;
        account =
          method === "api-key"
            ? { kind: "api_key", label: "OpenAI API key" }
            : { kind: "account", label: "ChatGPT Pro", account: { email: "user@example.com" } };
        return {};
      },
    ),
    getAcpDefaults: vi.fn(async () => ({
      configOptions: [
        {
          id: "reasoning_effort",
          name: "Reasoning effort",
          category: "thought_level",
          type: "select" as const,
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
      defaults: {},
      unmappedLegacy: [],
      invalidDefaults: [],
    })),
    setAcpDefaultConfig: vi.fn(async (_engine: string, _id: string, value: string | boolean) => ({
      configOptions: [
        {
          id: "reasoning_effort",
          name: "Reasoning effort",
          category: "thought_level",
          type: "select" as const,
          currentValue: String(value),
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        },
      ],
      defaults: {},
      unmappedLegacy: [],
      invalidDefaults: [],
    })),
  };
  const fullClient = client;
  const spies =
    platform === "desktop"
      ? [
          vi.spyOn(nativeClient, "getAcpAgent").mockImplementation(client.getAcpAgent),
          vi.spyOn(nativeClient, "getAcpProviders").mockImplementation(client.getAcpProviders),
          vi
            .spyOn(nativeClient, "configureAcpProvider")
            .mockImplementation(client.configureAcpProvider),
          vi
            .spyOn(nativeClient, "disableAcpProvider")
            .mockImplementation(client.disableAcpProvider),
          vi
            .spyOn(nativeClient, "authenticateAcpAgent")
            .mockImplementation(client.authenticateAcpAgent),
          vi.spyOn(nativeClient, "getAcpDefaults").mockImplementation(client.getAcpDefaults),
          vi
            .spyOn(nativeClient, "setAcpDefaultConfig")
            .mockImplementation(client.setAcpDefaultConfig),
        ]
      : [];
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    agentRuntime: "acp" as const,
    initialSection: "acp" as const,
    apps: [],
    models: [],
    error: null,
    isPending: false,
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onSave: vi.fn(),
  };
  const screen = await render(
    <QueryClientProvider client={query}>
      {platform === "web" ? (
        <WebPage {...props} client={fullClient as unknown as SettingsClient} />
      ) : (
        <NativePage {...props} />
      )}
    </QueryClientProvider>,
  );
  return {
    screen,
    client: fullClient,
    query,
    async close() {
      await screen.unmount();
      query.clear();
      spies.forEach((spy) => spy.mockRestore());
    },
  };
}
for (const platform of ["web", "desktop"] as const) {
  it(`${platform}：自动填充全局自定义 API，完整填写保存且不回显密钥`, async () => {
    const f = await fixture(platform);
    try {
      const url = f.screen.getByRole("textbox", { name: "API 地址", exact: true });
      await expect
        .element(f.screen.getByRole("dialog", { name: "全局设置", exact: true }))
        .toBeVisible();
      await expect
        .element(f.screen.getByRole("searchbox", { name: "搜索 Agent", exact: true }))
        .not.toBeInTheDocument();
      await expect
        .element(f.screen.getByRole("button", { name: "取消修改", exact: true }))
        .not.toBeInTheDocument();
      await expect.element(url).toHaveValue("https://global-custom.example/v1");
      await expect
        .element(f.screen.getByRole("heading", { name: "ACP", exact: true }))
        .not.toBeInTheDocument();
      await expect
        .element(f.screen.getByText("Custom model gateway", { exact: true }))
        .not.toBeInTheDocument();
      await expect
        .element(f.screen.getByRole("combobox", { name: "连接方式", exact: true }))
        .toHaveTextContent("自定义 API");
      await expect.element(f.screen.getByLabelText("API Key", { exact: true })).toHaveValue("");
      await url.fill("https://replacement.example/v1");
      await f.screen.getByLabelText("API Key", { exact: true }).fill("private-form-key");
      expect(f.client.configureAcpProvider).not.toHaveBeenCalled();
      await f.screen.getByRole("button", { name: "保存连接", exact: true }).click();
      await expect.poll(() => f.client.configureAcpProvider.mock.calls.length).toBe(1);
      expect(f.client.configureAcpProvider.mock.calls[0]?.[1]).toEqual({
        providerId: "openai",
        apiType: "openai",
        baseUrl: "https://replacement.example/v1",
        headers: { Authorization: "Bearer private-form-key" },
      });
      await expect.element(f.screen.getByText("应用内配置", { exact: true })).toBeVisible();
      expect(JSON.stringify(f.query.getQueriesData({}))).not.toContain("private-form-key");
      await expect.element(f.screen.getByLabelText("API Key", { exact: true })).toHaveValue("");
      await url.fill("https://keep-key.example/v1");
      await f.screen.getByRole("button", { name: "保存连接", exact: true }).click();
      await expect.poll(() => f.client.configureAcpProvider.mock.calls.length).toBe(2);
      expect(f.client.configureAcpProvider.mock.calls[1]?.[1]).not.toHaveProperty("headers");
    } finally {
      await f.close();
    }
  });
  it(`${platform}：连接表单失焦与切换分类不会自动保存`, async () => {
    const f = await fixture(platform);
    try {
      await f.screen
        .getByRole("textbox", { name: "API 地址", exact: true })
        .fill("https://unsaved.example/v1");
      await f.screen.getByRole("heading", { name: "连接配置", exact: true }).click();
      expect(f.client.configureAcpProvider).not.toHaveBeenCalled();
      await f.screen.getByRole("button", { name: "常规", exact: true }).click();
      await f.screen.getByRole("button", { name: "ACP", exact: true }).click();
      await expect
        .element(f.screen.getByRole("textbox", { name: "API 地址", exact: true }))
        .toHaveValue("https://global-custom.example/v1");
      expect(f.client.configureAcpProvider).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
  it(`${platform}：API Key 选择不会立即登录，提交完整凭据后才调用认证`, async () => {
    const f = await fixture(platform);
    try {
      await f.screen.getByRole("combobox", { name: "连接方式", exact: true }).click();
      await page.getByRole("option", { name: "账号登录", exact: true }).click();
      await f.screen.getByRole("combobox", { name: "登录方式", exact: true }).click();
      await page.getByRole("option", { name: "API Key", exact: true }).click();
      expect(f.client.authenticateAcpAgent).not.toHaveBeenCalled();
      await f.screen.getByRole("button", { name: "保存 API Key", exact: true }).click();
      expect(f.client.authenticateAcpAgent).not.toHaveBeenCalled();
      await f.screen.getByLabelText("API Key", { exact: true }).fill("native-form-key");
      await f.screen.getByRole("button", { name: "保存 API Key", exact: true }).click();
      await expect.poll(() => f.client.authenticateAcpAgent.mock.calls.length).toBe(1);
      expect(f.client.authenticateAcpAgent.mock.calls[0]?.[2]).toMatchObject({
        credentials: { apiKey: "native-form-key" },
      });
      await expect
        .element(f.screen.getByRole("button", { name: "保存 API Key", exact: true }))
        .toBeEnabled();
    } finally {
      await f.close();
    }
  });
  it(`${platform}：浏览器登录失败保留表单，重试成功后刷新真实账号`, async () => {
    const f = await fixture(platform);
    try {
      f.client.authenticateAcpAgent.mockRejectedValueOnce(new Error("offline"));
      await f.screen.getByRole("combobox", { name: "连接方式", exact: true }).click();
      await page.getByRole("option", { name: "账号登录", exact: true }).click();
      await f.screen.getByRole("combobox", { name: "登录方式", exact: true }).click();
      await page.getByRole("option", { name: "ChatGPT", exact: true }).click();
      await f.screen.getByRole("button", { name: "在浏览器中登录", exact: true }).click();
      await expect.element(f.screen.getByRole("alert")).toHaveTextContent("连接未保存");
      await f.screen.getByRole("button", { name: "在浏览器中登录", exact: true }).click();
      await expect
        .element(f.screen.getByText("ChatGPT Pro · user@example.com", { exact: true }))
        .toBeVisible();
      expect(f.client.authenticateAcpAgent).toHaveBeenCalledTimes(2);
    } finally {
      await f.close();
    }
  });
  it(`${platform}：取消未完成的浏览器登录不解除现有配置，迟到响应也不提交`, async () => {
    const f = await fixture(platform, "zh-CN", "application");
    let complete!: (value: Record<string, never>) => void;
    try {
      f.client.authenticateAcpAgent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      await f.screen.getByRole("combobox", { name: "连接方式", exact: true }).click();
      await page.getByRole("option", { name: "账号登录", exact: true }).click();
      await f.screen.getByRole("button", { name: "在浏览器中登录", exact: true }).click();
      await expect.poll(() => f.client.authenticateAcpAgent.mock.calls.length).toBe(1);
      const signal = f.client.authenticateAcpAgent.mock.calls[0]?.[2]?.signal;
      await f.screen.getByRole("button", { name: "取消", exact: true }).click();
      expect(signal?.aborted).toBe(true);
      complete({});
      await f.screen.getByRole("button", { name: "常规", exact: true }).click();
      await f.screen.getByRole("button", { name: "ACP", exact: true }).click();
      await expect
        .element(f.screen.getByRole("textbox", { name: "API 地址", exact: true }))
        .toHaveValue("https://global-custom.example/v1");
      expect(f.client.disableAcpProvider).not.toHaveBeenCalled();
      expect(f.client.configureAcpProvider).not.toHaveBeenCalled();
    } finally {
      complete?.({});
      await f.close();
    }
  });
  for (const language of ["zh-CN", "en"] as const) {
    it(`${platform}：${language} 配置标签和选项按语言显示，写入仍使用 ACP 原始值`, async () => {
      const f = await fixture(platform, language);
      try {
        const reasoning = f.screen.getByRole("combobox", {
          name: language === "zh-CN" ? "推理强度" : "Reasoning effort",
          exact: true,
        });
        await expect.element(reasoning).toHaveTextContent(language === "zh-CN" ? "高" : "High");
        await reasoning.click();
        await page
          .getByRole("option", { name: language === "zh-CN" ? "低" : "Low", exact: true })
          .click();
        expect(f.client.setAcpDefaultConfig).not.toHaveBeenCalled();
        await f.screen
          .getByRole("heading", {
            name: language === "zh-CN" ? "会话默认配置" : "Session defaults",
            exact: true,
          })
          .click();
        await expect.poll(() => f.client.setAcpDefaultConfig.mock.calls.length).toBe(1);
        expect(f.client.setAcpDefaultConfig.mock.calls[0]?.slice(0, 3)).toEqual([
          "codex",
          "reasoning_effort",
          "low",
        ]);
      } finally {
        await f.close();
      }
    });
  }
}
