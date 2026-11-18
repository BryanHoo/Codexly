import type { AgentEngine } from "@codexly/protocol";
import { useState } from "react";
import { Toaster, toast } from "@codexly/ui/core/toaster";
import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcpSettingsPanel } from "@codexly/ui/core/acp-settings-panel";
import {
  SettingsField,
  SettingsSelect,
} from "../../src/features/settings/components/global-settings-fields.js";
import { SettingsSaveFeedbackProvider } from "@codexly/ui/core/settings-save-status";
import type { AcpAgentCatalogPage, AcpAgentRegistration } from "@codexly/protocol";
import "../../src/shared/styles/globals.css";
for (const width of [390, 1280])
  it(`ACP 目录在 ${width}px 支持安装其他 Agent 和自定义命令`, async () => {
    await page.viewport(width, 900);
    const initial: AcpAgentCatalogPage = {
      agents: [
        {
          engine: "acp-gemini",
          name: "Gemini CLI",
          description: "Google agent",
          version: "1.0.0",
          installed: false,
          enabled: false,
          detected: false,
          environmentKeys: [],
        },
      ],
    };
    const installation = Promise.withResolvers<void>();
    const install = vi.fn(async () => {
      await installation.promise;
      return {
        agents: [
          {
            ...initial.agents[0]!,
            installed: true,
            enabled: true,
            command: "/bin/gemini",
            args: ["--acp"],
          },
        ],
      };
    });
    const configure = vi.fn(async (input: AcpAgentRegistration) => ({
      agents: [
        { ...initial.agents[0]!, ...input, installed: true, detected: false, environmentKeys: [] },
      ],
    }));
    const client = {
      getAcpAgentCatalog: vi.fn(async () => initial),
      installAcpAgent: install,
      configureAcpAgent: configure,
      getAcpAgent: (engine: AgentEngine) =>
        Promise.resolve({ engine, protocolVersion: 1, authMethods: [] }),
      getAcpDefaults: () =>
        Promise.resolve({
          configOptions: [],
          defaults: {},
          unmappedLegacy: [],
          invalidDefaults: [],
        }),
      setAcpDefaultConfig: () => Promise.reject(new Error("unused")),
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
    await screen.getByRole("button", { name: "添加 Agent", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "Gemini CLI" })).toBeVisible();
    const close = page.getByRole("button", { name: "关闭", exact: true });
    await expect.element(close).toBeVisible();
    expect(document.querySelectorAll('[data-slot="dialog-close"]')).toHaveLength(1);
    await close.click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "添加 Agent", exact: true }))
      .toHaveFocus();
    await screen.getByRole("button", { name: "添加 Agent", exact: true }).click();
    expect(install).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "安装并启用" }).click();
    await expect.element(close).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).toBeVisible();
    installation.resolve();
    await expect
      .element(screen.getByRole("button", { name: "Gemini CLI", exact: true }))
      .toBeVisible();
    expect(install).toHaveBeenCalledExactlyOnceWith(
      "acp-gemini",
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    await screen.getByRole("button", { name: "添加 Agent", exact: true }).click();
    await page.getByRole("button", { name: "配置自定义 Agent" }).click();
    await page.getByRole("textbox", { name: "名称", exact: true }).fill("本机助手");
    await page.getByRole("textbox", { name: "可执行程序路径" }).fill("/path with spaces/agent");
    await page.getByRole("textbox", { name: "参数（JSON 数组）" }).fill('["--acp", "a b"]');
    await page.getByRole("button", { name: "保存配置" }).click();
    await expect.poll(() => configure.mock.calls.length).toBe(1);
    expect(configure.mock.calls[0]?.[0]).toMatchObject({
      name: "本机助手",
      command: "/path with spaces/agent",
      args: ["--acp", "a b"],
      enabled: true,
    });
    await screen.unmount();
  });
it("检测到的其他 Agent 自动进入工作区，未启动账号或模型探测", async () => {
  const { AcpEngineSetupGate } = await import("@codexly/ui/core/acp-engine-setup-gate");
  const getAcpAgent = vi.fn(() => Promise.reject(new Error("不应启动")));
  const client = {
    getAcpAgentCatalog: () =>
      Promise.resolve({
        agents: [
          {
            engine: "acp-gemini" as const,
            name: "Gemini",
            description: "",
            installed: true,
            enabled: true,
            detected: true,
            environmentKeys: [],
          },
        ],
      }),
    getAcpAgent,
    getAcpDefaults: () => Promise.reject(new Error("不应创建会话")),
    authenticateAcpAgent: () => Promise.resolve({}),
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <AcpEngineSetupGate client={client} language="zh-CN">
        <p>工作区已就绪</p>
      </AcpEngineSetupGate>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByText("工作区已就绪")).toBeVisible();
  expect(getAcpAgent).not.toHaveBeenCalled();
  await screen.unmount();
});

afterEach(() => toast.dismiss());
function BackgroundWorkspace() {
  const [count, setCount] = useState(0);
  const engines = useSelectedEngines();
  return (
    <div>
      <button onClick={() => setCount((value) => value + 1)}>工作区操作 {count}</button>
      <output aria-label="可用 Agent">{engines?.join(",") || "暂无"}</output>
    </div>
  );
}
for (const width of [390, 1280])
  it(`${width}px 后台检测立即开放工作区，同一通知更新且保留编辑状态`, async () => {
    await page.viewport(width, 900);
    const { AcpEngineSetupGate } = await import("@codexly/ui/core/acp-engine-setup-gate");
    const pending = Promise.withResolvers<AcpAgentCatalogPage>();
    const client = {
      getAcpAgentCatalog: vi.fn(() => pending.promise),
      getAcpAgent: vi.fn(() => Promise.reject(new Error("不应握手"))),
      getAcpDefaults: () => Promise.reject(new Error("不应创建会话")),
      authenticateAcpAgent: () => Promise.resolve({}),
    };
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Toaster />
        <AcpEngineSetupGate client={client} language="zh-CN">
          <BackgroundWorkspace />
        </AcpEngineSetupGate>
      </QueryClientProvider>,
    );
    await expect.element(screen.getByRole("button", { name: "工作区操作 0" })).toBeVisible();
    await expect
      .element(page.getByText("正在后台检测和准备 Agent…", { exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "工作区操作 0" }).click();
    pending.resolve({
      agents: [
        {
          engine: "acp-gemini",
          name: "Gemini",
          description: "",
          installed: true,
          enabled: true,
          detected: true,
          environmentKeys: [],
        },
      ],
    });
    await expect
      .element(screen.getByRole("status", { name: "可用 Agent" }))
      .toHaveTextContent("acp-gemini");
    await expect.element(screen.getByRole("button", { name: "工作区操作 1" })).toBeVisible();
    await expect.element(page.getByText("Agent 已就绪", { exact: true })).toBeVisible();
    expect(document.querySelectorAll('[data-slot="toast"]')).toHaveLength(1);
    expect(client.getAcpAgentCatalog).toHaveBeenCalledOnce();
    expect(client.getAcpAgent).not.toHaveBeenCalled();
    await screen.unmount();
  });
it("后台检测失败后仍可操作工作区，通知支持重试且空目录不强制跳转", async () => {
  const { AcpEngineSetupGate } = await import("@codexly/ui/core/acp-engine-setup-gate");
  const getAcpAgentCatalog = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ agents: [] });
  const client = {
    getAcpAgentCatalog,
    getAcpAgent: () => Promise.reject(new Error("不应握手")),
    getAcpDefaults: () => Promise.reject(new Error("不应创建会话")),
    authenticateAcpAgent: () => Promise.resolve({}),
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <Toaster />
      <AcpEngineSetupGate client={client} language="zh-CN">
        <BackgroundWorkspace />
      </AcpEngineSetupGate>
    </QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "工作区操作 0" }).click();
  await expect.element(page.getByText("Agent 后台检测失败", { exact: true })).toBeVisible();
  await page.getByText("Agent 后台检测失败", { exact: true }).hover();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect.element(page.getByText("尚未发现可用 Agent", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "工作区操作 1" })).toBeVisible();
  expect(getAcpAgentCatalog).toHaveBeenCalledTimes(2);
  expect(getAcpAgentCatalog.mock.calls[1]?.[0]).toMatchObject({ refresh: true });
  await expect
    .element(screen.getByRole("status", { name: "可用 Agent" }))
    .toHaveTextContent("暂无");
  await screen.unmount();
});
it("目录模式保留原左右配置布局，添加按钮只出现在左侧 Agent 栏", async () => {
  const { AcpSettingsPanel } = await import("@codexly/ui/core/acp-settings-panel");
  const { SettingsField, SettingsSelect } =
    await import("../../src/features/settings/components/global-settings-fields.js");
  const data: AcpAgentCatalogPage = {
    agents: [
      {
        engine: "codex",
        name: "Codex",
        description: "",
        installed: true,
        enabled: true,
        detected: true,
        command: "/bin/codex",
        args: [],
        environmentKeys: [],
      },
    ],
  };
  const client = {
    getAcpAgentCatalog: () => Promise.resolve(data),
    installAcpAgent: () => Promise.resolve(data),
    configureAcpAgent: () => Promise.resolve(data),
    getAcpAgent: () =>
      Promise.resolve({ engine: "codex" as const, protocolVersion: 1, authMethods: [] }),
    getAcpDefaults: () =>
      Promise.resolve({ configOptions: [], defaults: {}, unmappedLegacy: [], invalidDefaults: [] }),
    setAcpDefaultConfig: () => Promise.reject(new Error("unused")),
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
  await expect
    .element(screen.getByRole("heading", { name: "会话默认配置", exact: true }))
    .toBeVisible();
  const add = screen.getByRole("button", { name: "添加 Agent", exact: true });
  expect(add.element().closest('aside[aria-label="Agent"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain("自动发现此电脑上的 Agent");
  await add.click();
  await expect
    .element(page.getByRole("dialog").getByRole("heading", { name: "添加 Agent", exact: true }))
    .toBeVisible();
  await screen.unmount();
});
