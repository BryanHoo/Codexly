import { page, userEvent } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AcpAgentProfile, AcpAuthElicitationRequest, AcpAuthElicitationResponse, AcpProviderConfig } from "@codexly/protocol";
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
  source: "native" | "application" | "disconnected" = "native",
) {
  await Promise.all([webLanguage(language), nativeLanguage(language)]);
  let connection: AcpAgentProfile["connection"] =
    source === "disconnected"
      ? undefined
      : {
          source,
          providerId: "openai",
          baseUrl: "https://global-custom.example/v1",
          apiType: "openai",
          hasCredentials: true,
        };
  let account: AcpAgentProfile["authStatus"] =
    source === "disconnected"
      ? { kind: "none", label: "Not signed in" }
      : { kind: "gateway", label: "Custom model gateway", detail: "OpenAI" };
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
    getAcpAgentCatalog: vi.fn(async () => ({
      agents: [{
        engine: "codex" as const,
        name: "Codex",
        description: "",
        installed: true,
        enabled: true,
        detected: true,
        environmentKeys: [],
        command: "/bin/codex",
      }],
    })),
    getAcpAgent: vi.fn(async (): Promise<AcpAgentProfile> => ({
      engine: "codex",
      protocolVersion: 2,
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
        _options?: { signal?: AbortSignal; credentials?: { apiKey?: string }; attemptId?: string },
      ) => {
        connection = undefined;
        account =
          method === "api-key"
            ? { kind: "api_key", label: "OpenAI API key" }
            : { kind: "account", label: "ChatGPT Pro", account: { email: "user@example.com" } };
        return {};
      },
    ),
    acpAuthElicitation: vi.fn((_engine: string, _input: AcpAuthElicitationRequest): Promise<AcpAuthElicitationResponse> => Promise.resolve([])),
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
          vi.spyOn(nativeClient, "getAcpAgentCatalog").mockImplementation(client.getAcpAgentCatalog),
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
          vi.spyOn(nativeClient, "acpAuthElicitation").mockImplementation(client.acpAuthElicitation),
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
    onClose: props.onClose,
    async close() {
      await screen.unmount();
      query.clear();
      spies.forEach((spy) => spy.mockRestore());
    },
  };
}
for (const platform of ["web", "desktop"] as const) {
  it(`${platform}：在发起登录的设置界面提交认证问卷`, async () => {
    const f = await fixture(platform);
    const finish = Promise.withResolvers<Record<string, never>>();
    f.client.authenticateAcpAgent.mockReturnValueOnce(finish.promise);
    f.client.acpAuthElicitation.mockImplementation(async (_engine, input) => {
      if ("requestId" in input) {
        finish.resolve({});
        return [];
      }
      return [{
        type: "mcp_elicitation", acp: true, mode: "form", status: "pending",
        requestId: "auth-form", projectId: "acp-settings", taskId: "codex", turnId: input.attemptId,
        itemId: "auth-form-item", createdAt: "2026-11-23T00:00:00Z", expiresAt: null,
        serverName: "Codex", message: "确认认证区域",
        fields: [{ id: "region", title: "区域", type: "string", description: null, required: true, defaultValue: null, format: null, maxLength: null, minLength: null }],
      }];
    });
    try {
      await f.screen.getByRole("combobox", { name: "连接方式", exact: true }).click();
      await page.getByRole("option", { name: "账号登录", exact: true }).click();
      await f.screen.getByRole("combobox", { name: "登录方式", exact: true }).click();
      await page.getByRole("option", { name: "ChatGPT", exact: true }).click();
      await f.screen.getByRole("button", { name: "在浏览器中登录", exact: true }).click();
      await expect.element(f.screen.getByText("确认认证区域", { exact: true })).toBeVisible();
      await f.screen.getByRole("textbox", { name: "区域" }).fill("cn");
      await f.screen.getByRole("button", { name: "提交", exact: true }).click();
      const attemptId = f.client.authenticateAcpAgent.mock.calls[0]?.[2]?.attemptId;
      expect(attemptId).toBeTruthy();
      expect(f.client.acpAuthElicitation).toHaveBeenCalledWith("codex", {
        attemptId, requestId: "auth-form", resolution: { action: "accept", content: { region: "cn" } },
      });
      await expect.element(f.screen.getByText("确认认证区域", { exact: true })).not.toBeInTheDocument();
    } finally {
      finish.resolve({});
      await f.close();
    }
  });
it(`${platform}：点击设置遮罩时先收起 API 协议下拉，保留连接草稿`, async () => {
  await page.viewport(1280, 900);
  const f = await fixture(platform);
  try {
    const dialog = f.screen.getByRole("dialog", { name: "全局设置", exact: true });
    const url = dialog.getByRole("textbox", { name: "API 地址", exact: true });
    await url.fill("https://draft.example/v1");
    const protocol = dialog.getByRole("combobox", { name: "API 协议", exact: true });
    await protocol.click();
    await expect.element(page.getByRole("listbox")).toBeVisible();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (!overlay) throw new Error("找不到设置遮罩");
    const backdrop = page.elementLocator(overlay);
    await backdrop.click({ force: true, position: { x: 4, y: 4 } });
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
    await expect.element(dialog).toBeVisible();
    await expect.element(url).toHaveValue("https://draft.example/v1");
    expect(f.onClose).not.toHaveBeenCalled();
    await protocol.click();
    await expect.element(page.getByRole("listbox")).toBeVisible();
    await url.click({ force: true });
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
    expect(f.onClose).not.toHaveBeenCalled();
    await protocol.click();
    await expect.element(page.getByRole("listbox")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
    await expect.element(protocol).toHaveFocus();
    expect(f.onClose).not.toHaveBeenCalled();
    await backdrop.click({ force: true, position: { x: 4, y: 4 } });
    await expect.poll(() => f.onClose.mock.calls.length).toBe(1);
  } finally {
    await f.close();
  }
});
}
for (const platform of ["web", "desktop"] as const) {
  it(`${platform}：保存自定义 API 后加载会话默认配置`, async () => {
    const f = await fixture(platform, "zh-CN", "disconnected");
    try {
      await expect.element(f.screen.getByText("未登录", { exact: true })).toBeVisible();
      expect(f.client.getAcpDefaults).not.toHaveBeenCalled();
      await f.screen.getByRole("combobox", { name: "连接方式", exact: true }).click();
      await page.getByRole("option", { name: "自定义 API", exact: true }).click();
      await f.screen
        .getByRole("textbox", { name: "API 地址", exact: true })
        .fill("https://custom.example/v1");
      await f.screen.getByLabelText("API Key", { exact: true }).fill("custom-form-key");
      expect(f.client.getAcpDefaults).not.toHaveBeenCalled();
      await f.screen.getByRole("button", { name: "保存连接", exact: true }).click();
      await expect
        .element(f.screen.getByRole("status", { name: "连接状态", exact: true }))
        .toHaveTextContent(/^已连接$/u);
      await expect
        .element(f.screen.getByRole("combobox", { name: "推理强度", exact: true }))
        .toHaveTextContent("高");
    } finally {
      await f.close();
    }
  });
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
      await expect.element(f.screen.getByText("配置来源", { exact: true })).not.toBeInTheDocument();
      await expect.element(f.screen.getByText("应用内配置", { exact: true })).not.toBeInTheDocument();
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
    const f = await fixture(platform, "zh-CN", "disconnected");
    try {
      await expect.element(f.screen.getByText("未登录", { exact: true })).toBeVisible();
      expect(f.client.getAcpDefaults).not.toHaveBeenCalled();
      f.client.authenticateAcpAgent.mockRejectedValueOnce(new Error("offline"));
      await f.screen.getByRole("combobox", { name: "连接方式", exact: true }).click();
      await page.getByRole("option", { name: "账号登录", exact: true }).click();
      await f.screen.getByRole("combobox", { name: "登录方式", exact: true }).click();
      await page.getByRole("option", { name: "ChatGPT", exact: true }).click();
      await f.screen.getByRole("button", { name: "在浏览器中登录", exact: true }).click();
      await expect.element(f.screen.getByRole("alert")).toHaveTextContent("连接未保存");
      expect(f.client.getAcpDefaults).not.toHaveBeenCalled();
      await f.screen.getByRole("button", { name: "在浏览器中登录", exact: true }).click();
      const status = f.screen.getByRole("status", { name: "连接状态", exact: true });
      await expect.element(status).toHaveAttribute("title", "ChatGPT Pro · user@example.com");
      await expect.element(status).toHaveTextContent(/^已连接$/u);
      expect(f.client.authenticateAcpAgent).toHaveBeenCalledTimes(2);
      await expect
        .element(f.screen.getByRole("combobox", { name: "推理强度", exact: true }))
        .toHaveTextContent("高");
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
