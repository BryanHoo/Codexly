import { EngineSelectionProvider } from "@codexly/ui/core/engine-selection-provider";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcpSettingsPanel } from "@codexly/ui/core/acp-settings-panel";
import { SettingsSaveFeedbackProvider } from "@codexly/ui/core/settings-save-status";
import {
  SettingsField,
  SettingsSelect,
} from "../../src/features/settings/components/global-settings-fields.js";
import type { AcpDefaults, AgentEngine } from "@codexly/protocol";
import "../../src/shared/styles/globals.css";

it("只读取选中 Agent，失焦保存完成后才切换", async () => {
  let complete!: (value: AcpDefaults) => void;
  const defaults: AcpDefaults = {
    configOptions: [
      {
        id: "model",
        name: "模型",
        type: "select",
        currentValue: "a",
        options: [
          { value: "a", name: "甲" },
          { value: "b", name: "乙" },
        ],
      },
    ],
    defaults: {},
    unmappedLegacy: [],
    invalidDefaults: [],
  };
  const client = {
    getAcpAgent: vi.fn(async (engine: AgentEngine) => ({
      engine,
      protocolVersion: 1,
      authMethods: [{ id: "login", name: "原生登录" }],
    })),
    authenticateAcpAgent: vi.fn(async () => ({})),
    getAcpDefaults: vi.fn(async () => defaults),
    setAcpDefaultConfig: vi.fn(
      () =>
        new Promise<AcpDefaults>((resolve) => {
          complete = resolve;
        }),
    ),
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsSaveFeedbackProvider>
        <AcpSettingsPanel
          client={client}
          language="zh-CN"
          Field={SettingsField}
          Select={SettingsSelect}
        />
      </SettingsSaveFeedbackProvider>
    </QueryClientProvider>,
  );
  const model = screen.getByRole("combobox", { name: "模型", exact: true });
  await expect.element(model).toHaveTextContent("甲");
  expect(client.getAcpAgent.mock.calls.every(([engine]) => engine === "codex")).toBe(true);
  await expect
    .element(screen.getByRole("searchbox", { name: "搜索 Agent" }))
    .not.toBeInTheDocument();
  await expect.element(model).toHaveTextContent("甲");
  await model.click();
  await page.getByRole("option", { name: "乙", exact: true }).click();
  expect(client.setAcpDefaultConfig).not.toHaveBeenCalled();
  await screen.getByRole("heading", { name: "会话默认配置", exact: true }).click();
  await expect.element(model).toBeDisabled();
  await screen.getByRole("button", { name: /Claude Code/ }).click();
  expect(client.getAcpAgent.mock.calls.every(([engine]) => engine === "codex")).toBe(true);
  complete({ ...defaults, configOptions: [] });
  await expect
    .poll(() => client.getAcpAgent.mock.calls.some(([engine]) => engine === "claude"))
    .toBe(true);
  await expect
    .element(screen.getByRole("heading", { name: "Claude Code", exact: true }))
    .toBeVisible();
  await screen.unmount();
});

for (const width of [390, 1280])
  for (const theme of ["light", "dark"] as const) {
    it(`ACP 配置在 ${width}px ${theme} 下适配布局且不横向溢出`, async () => {
      await page.viewport(width, 900);
      document.documentElement.style.colorScheme = theme;
      const client = {
        getAcpAgent: vi.fn(async (engine: AgentEngine) => ({
          engine,
          protocolVersion: 1,
          agentInfo: { name: "codex", version: "1.0" },
          authStatus: {
            kind: "account" as const,
            label: "ChatGPT Pro",
            account: { email: "bryan@example.com" },
          },
          authMethods: [{ id: "login", name: "ChatGPT" }],
        })),
        authenticateAcpAgent: vi.fn(async () => ({})),
        getAcpDefaults: vi.fn(async () => ({
          configOptions: [
            {
              id: "model",
              name: "模型",
              type: "select" as const,
              currentValue: "gpt",
              options: [{ value: "gpt", name: "GPT-5.6" }],
            },
            {
              id: "reasoning",
              name: "推理强度",
              type: "select" as const,
              currentValue: "high",
              options: [{ value: "high", name: "High" }],
            },
            {
              id: "mode",
              name: "权限模式",
              type: "select" as const,
              currentValue: "workspace",
              options: [{ value: "workspace", name: "Workspace" }],
            },
          ],
          defaults: {},
          unmappedLegacy: [],
          invalidDefaults: [],
        })),
        setAcpDefaultConfig: vi.fn(),
      };
      const screen = await render(
        <div className="p-5">
          <QueryClientProvider client={new QueryClient()}>
            <AcpSettingsPanel
              client={client}
              language="zh-CN"
              Field={SettingsField}
              Select={SettingsSelect}
            />
          </QueryClientProvider>
        </div>,
      );
      await expect.element(screen.getByText("v1.0", { exact: true })).toBeVisible();
      const agent = screen
        .getByRole("navigation", { name: "选择 Agent" })
        .element()
        .getBoundingClientRect();
      // 使用真实设置标题验证主从布局与移动端的自然顺序。
      const details = screen
        .getByText("会话默认配置", { exact: true })
        .element()
        .getBoundingClientRect();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
      expect(
        width >= 1024 ? details.left - agent.right : details.top - agent.bottom,
      ).toBeGreaterThan(0);
      await page.screenshot({
        path: `../../test-results/acp-settings-refined-${width}-${theme}.png`,
      });
      await screen.unmount();
      document.documentElement.style.colorScheme = "";
    });
  }

it("保存失败时保留当前 Agent，重试成功后允许切换", async () => {
  const defaults: AcpDefaults = {
    configOptions: [
      {
        id: "model",
        name: "模型",
        type: "select",
        currentValue: "a",
        options: [
          { value: "a", name: "甲" },
          { value: "b", name: "乙" },
        ],
      },
    ],
    defaults: {},
    unmappedLegacy: [],
    invalidDefaults: [],
  };
  const client = {
    getAcpAgent: vi.fn(async (engine: AgentEngine) => ({
      engine,
      protocolVersion: 1,
      authMethods: [],
    })),
    authenticateAcpAgent: vi.fn(async () => ({})),
    getAcpDefaults: vi.fn(async () => defaults),
    setAcpDefaultConfig: vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ...defaults, configOptions: [] }),
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsSaveFeedbackProvider>
        <AcpSettingsPanel
          client={client}
          language="zh-CN"
          Field={SettingsField}
          Select={SettingsSelect}
        />
      </SettingsSaveFeedbackProvider>
    </QueryClientProvider>,
  );
  await screen.getByRole("combobox", { name: "模型", exact: true }).click();
  await page.getByRole("option", { name: "乙", exact: true }).click();
  await screen.getByRole("heading", { name: "会话默认配置", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("设置保存失败");
  await screen.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: /Claude Code/ }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Claude Code", exact: true }))
    .toBeVisible();
  await screen.unmount();
});

it("Agent 开关直接更新启用选择，独立于栏目选择且保留已有配置", async () => {
  const data = new Map<string, string>();
  const client = {
    getAcpAgent: vi.fn(async (engine: AgentEngine) => ({
      engine,
      protocolVersion: 1,
      authMethods: [],
    })),
    getAcpDefaults: vi.fn(async () => ({
      configOptions: [],
      defaults: {},
      unmappedLegacy: [],
      invalidDefaults: [],
    })),
    setAcpDefaultConfig: vi.fn(),
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <EngineSelectionProvider
        engines={["codex", "claude"]}
        storage={{
          getItem: (key) => data.get(key) ?? null,
          setItem: (key, value) => {
            data.set(key, value);
          },
        }}
      >
        <AcpSettingsPanel
          client={client}
          language="zh-CN"
          Field={SettingsField}
          Select={SettingsSelect}
        />
      </EngineSelectionProvider>
    </QueryClientProvider>,
  );
  await expect
    .element(screen.getByRole("heading", { name: "连接配置", exact: true }))
    .toBeVisible();
  const toggle = screen.getByRole("switch", { name: "启用 Claude Code", exact: true });
  await toggle.click();
  await expect.element(toggle).not.toBeChecked();
  await expect.element(screen.getByRole("heading", { name: "Codex", exact: true })).toBeVisible();
  expect(client.getAcpAgent.mock.calls.every(([engine]) => engine === "codex")).toBe(true);
  await toggle.click();
  await expect.element(toggle).toBeChecked();
  expect(client.getAcpAgent.mock.calls.filter(([engine]) => engine === "claude")).toHaveLength(1);
  expect(client.getAcpDefaults.mock.calls).toHaveLength(1);
  expect(client.setAcpDefaultConfig).not.toHaveBeenCalled();
  await screen.unmount();
});
