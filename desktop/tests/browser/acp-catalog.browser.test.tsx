import type { AgentEngine } from "@codexly/protocol";
import { useState } from "react";
import { Toaster, toast } from "@codexly/ui/core/toaster";
import { useSelectedEngines } from "@codexly/ui/core/engine-selection";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AcpSettingsPanel } from "@codexly/ui/core/acp-settings-panel";
import {
  SettingsField,
  SettingsSelect,
} from "../../src/features/settings/components/global-settings-fields.js";
import { SettingsSaveFeedbackProvider } from "@codexly/ui/core/settings-save-status";
import { TooltipProvider } from "@codexly/ui/core/tooltip";
import type { AcpAgentCatalogPage, AcpAgentCatalogProgress, AcpAgentRegistration } from "@codexly/protocol";
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
      getAcpAgentCatalogProgress: async (): Promise<AcpAgentCatalogProgress> => ({
        operations: [{
          engine: "acp-gemini", name: "Gemini CLI", action: "install",
          progress: { stage: "downloading", received: 50, total: 100 },
        }],
      }),
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
    const search = page.getByLabelText("搜索 Agent", { exact: true });
    await expect.element(search).toHaveFocus();
    const searchBounds = search.element().getBoundingClientRect();
    // 焦点描边必须完整落在每个会裁切内容的祖先范围内。
    for (let parent = search.element().parentElement; parent; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if (overflow === "visible") continue;
      const bounds = parent.getBoundingClientRect();
      expect(searchBounds.top - bounds.top).toBeGreaterThanOrEqual(3);
      expect(searchBounds.left - bounds.left).toBeGreaterThanOrEqual(3);
      if (parent.getAttribute("role") === "dialog") break;
    }
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
    await expect.element(page.getByRole("progressbar", { name: "正在下载安装包" }))
      .toHaveAttribute("aria-valuenow", "50");
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

// 每个启动用例独立验证首次初始化，不能继承其他用例的完成记录。
beforeEach(() => localStorage.removeItem("codexly:acp-engine-setup:v1"));
afterEach(() => {
  toast.dismiss();
  localStorage.removeItem("codexly:acp-engine-setup:v1");
});
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
      getAcpAgentCatalogProgress: vi.fn(async (): Promise<AcpAgentCatalogProgress> => ({
        discovery: { checked: 3, total: 14 },
        operations: [{
          engine: "acp-gemini", name: "Gemini", action: "automatic",
          progress: { stage: "installing" },
        }],
      })),
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
    await expect.element(page.getByText(/已检测 3\/14.*Gemini.*正在安装依赖/)).toBeVisible();
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

it("已安装 Agent 显示更新进度，确认后才从目录移除", async () => {
  await page.viewport(390, 900);
  const data: AcpAgentCatalogPage = {
    agents: [{
      engine: "codex", name: "Codex", description: "", installed: true, enabled: true,
      detected: true, command: "/bin/codex", environmentKeys: [], canUpdate: true,
      installedVersion: "1.2.3",
    }],
  };
  const pendingUpdate = Promise.withResolvers<AcpAgentCatalogPage>();
  const updateAcpAgent = vi.fn(() => pendingUpdate.promise);
  const removeAcpAgent = vi.fn(async () => ({ agents: [] }));
  const client = {
    getAcpAgentCatalog: async () => data,
    getAcpAgentCatalogProgress: vi.fn(async (): Promise<AcpAgentCatalogProgress> => ({
      operations: [{
        engine: "codex", name: "Codex", action: "update", progress: { stage: "extracting" },
      }],
    })),
    installAcpAgent: async () => data,
    configureAcpAgent: async () => data,
    updateAcpAgent,
    removeAcpAgent,
    getAcpAgent: async () => ({ engine: "codex" as const, protocolVersion: 1, authMethods: [] }),
    getAcpDefaults: async () => ({ configOptions: [], defaults: {}, unmappedLegacy: [], invalidDefaults: [] }),
    setAcpDefaultConfig: () => Promise.reject(new Error("unused")),
  };
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsSaveFeedbackProvider>
        <TooltipProvider>
          <AcpSettingsPanel
            client={client}
            language="zh-CN"
            Field={SettingsField}
            Select={SettingsSelect}
          />
        </TooltipProvider>
      </SettingsSaveFeedbackProvider>
    </QueryClientProvider>,
  );
  const version = screen.getByText("v1.2.3", { exact: true });
  const update = screen.getByRole("button", { name: "更新 Agent" });
  const remove = screen.getByRole("button", { name: "移除 Agent" });
  await expect.element(version).toBeVisible();
  const versionRect = version.element().getBoundingClientRect();
  for (const control of [update, remove]) {
    expect(control.element().textContent).toBe("");
    const rect = control.element().getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(versionRect.right);
    expect(rect.top + rect.height / 2).toBeCloseTo(versionRect.top + versionRect.height / 2, 0);
  }
  // 控件的左右顺序始终单独验证，避免条件分支跳过布局断言。
  expect(remove.element().getBoundingClientRect().left).toBeGreaterThan(
    update.element().getBoundingClientRect().left,
  );
  await update.hover();
  await expect.element(page.getByRole("tooltip", { name: "更新 Agent" })).toBeVisible();
  await update.click();
  await expect.element(screen.getByText("正在解压安装包", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "移除 Agent" })).toBeDisabled();
  pendingUpdate.resolve(data);
  await screen.getByRole("button", { name: "移除 Agent" }).click();
  const dialog = page.getByRole("dialog", { name: "移除 Codex？" });
  await expect.element(dialog).toBeVisible();
  expect(removeAcpAgent).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: "移除", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Codex", exact: true })).not.toBeInTheDocument();
  expect(updateAcpAgent).toHaveBeenCalledOnce();
  expect(removeAcpAgent).toHaveBeenCalledOnce();
  await screen.unmount();
});
it("目录模式保留左右配置布局，添加按钮固定在 Agent 栏底部", async () => {
  await page.viewport(1280, 900);
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
        <div style={{ height: 600 }}>
          <AcpSettingsPanel
            client={client}
            language="zh-CN"
            Field={SettingsField}
            Select={SettingsSelect}
          />
        </div>
      </SettingsSaveFeedbackProvider>
    </QueryClientProvider>,
  );
  await expect
    .element(screen.getByRole("heading", { name: "会话默认配置", exact: true }))
    .toBeVisible();
  const add = screen.getByRole("button", { name: "添加 Agent", exact: true });
  const sidebar = add.element().closest('aside[aria-label="Agent"]');
  const addRect = add.element().getBoundingClientRect();
  const navRect = screen
    .getByRole("navigation", { name: "选择 Agent" })
    .element()
    .getBoundingClientRect();
  expect(sidebar).not.toBeNull();
  expect(addRect.top).toBeGreaterThanOrEqual(navRect.bottom);
  expect(navRect.height).toBeGreaterThan(450);
  expect((sidebar?.getBoundingClientRect().bottom ?? 0) - addRect.bottom).toBeLessThanOrEqual(24);
  expect(document.body.textContent).not.toContain("自动发现此电脑上的 Agent");
  await add.click();
  await expect
    .element(page.getByRole("dialog").getByRole("heading", { name: "添加 Agent", exact: true }))
    .toBeVisible();
  await screen.unmount();
});
