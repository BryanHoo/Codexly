import { page } from "vitest/browser";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { AcpDefaults, AcpConfigPreviewRequest } from "@codexly/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentSettingsPanel as WebPanel } from "../../../apps/web/src/features/settings/components/agent-settings-panel.js";
import { AgentSettingsPanel as DesktopPanel } from "../../src/features/settings/components/agent-settings-panel.js";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as nativeLanguage } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";
const initial: AcpDefaults = {
  configOptions: [
    {
      id: "model",
      name: "原生模型",
      type: "select",
      currentValue: "a",
      options: [
        { value: "a", name: "模型甲" },
        { value: "b", name: "模型乙" },
      ],
    },
    { id: "fast-mode", name: "快速模式", type: "boolean", currentValue: false },
  ],
  defaults: {},
  unmappedLegacy: [],
  invalidDefaults: [],
};
function clientFixture() {
  const previewAcpDefaults = vi.fn(async (_engine: string, input: AcpConfigPreviewRequest) => {
    const values = {
      ...input.values,
      ...(input.change ? { [input.change.configId]: input.change.value } : {}),
    };
    return {
      values,
      configOptions: initial.configOptions.map((option) => ({
        ...option,
        currentValue: values[option.id] ?? option.currentValue,
      })) as AcpDefaults["configOptions"],
    };
  });
  const updateAcpDefaults = vi.fn(
    async (_engine: string, values: Record<string, string | boolean>) => ({
      ...initial,
      defaults: values,
      configOptions: initial.configOptions.map((option) => ({
        ...option,
        currentValue: values[option.id] ?? option.currentValue,
      })) as AcpDefaults["configOptions"],
    }),
  );
  return {
    getAcpDefaults: vi.fn(async () => initial),
    setAcpDefaultConfig: vi.fn(
      async (
        _engine: string,
        id: string,
        value: string | boolean,
        _options?: { idempotencyKey?: string },
      ) => ({
        ...initial,
        configOptions: initial.configOptions.map((option) => ({
          ...option,
          currentValue: option.id === id ? value : option.currentValue,
        })) as AcpDefaults["configOptions"],
      }),
    ),
    previewAcpDefaults,
    updateAcpDefaults,
  };
}
beforeEach(async () => {
  await webLanguage("zh-CN");
  await nativeLanguage("zh-CN");
});
for (const [platform, Panel] of [
  ["web", WebPanel],
  ["desktop", DesktopPanel],
] as const) {
  it(`${platform}：会话默认值失焦保存，不显示内部字段与手动保存按钮`, async () => {
    const client = clientFixture();
    client.getAcpDefaults.mockResolvedValue({
      ...initial,
      unmappedLegacy: ["loadProjectSettings"],
      invalidDefaults: ["internal-key"],
    });
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Panel client={client} />
      </QueryClientProvider>,
    );
    await screen.getByRole("switch", { name: "快速模式" }).click();
    expect(client.setAcpDefaultConfig).not.toHaveBeenCalled();
    await screen.getByRole("heading").click();
    await expect.poll(() => client.setAcpDefaultConfig.mock.calls.length).toBe(1);
    expect(client.setAcpDefaultConfig.mock.calls[0]?.slice(0, 3)).toEqual([
      "codex",
      "fast-mode",
      true,
    ]);
    await expect.element(screen.getByText(/loadProjectSettings/)).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "保存配置", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "取消修改", exact: true }))
      .not.toBeInTheDocument();
    await screen.unmount();
  });
  it(`${platform}：保存失败保留草稿，重试复用提交身份`, async () => {
    const client = clientFixture();
    client.setAcpDefaultConfig.mockRejectedValueOnce(new Error("offline"));
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Panel client={client} />
      </QueryClientProvider>,
    );
    await screen.getByRole("switch", { name: "快速模式" }).click();
    await screen.getByRole("heading").click();
    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(screen.getByRole("switch", { name: "快速模式" })).toBeChecked();
    await screen.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => client.setAcpDefaultConfig.mock.calls.length).toBe(2);
    const calls = client.setAcpDefaultConfig.mock.calls as unknown as [
      string,
      string,
      string | boolean,
      { idempotencyKey: string },
    ][];
    expect(calls[0]?.[3].idempotencyKey).toBe(calls[1]?.[3].idempotencyKey);
    await screen.unmount();
  });
  it(`${platform}：默认选项允许空字符串，展示默认并原样保存`, async () => {
    const client = clientFixture();
    const option = {
      id: "verbosity",
      name: "回复详细程度",
      type: "select" as const,
      currentValue: "low",
      options: [
        { value: "", name: "" },
        { value: "low", name: "Low" },
      ],
    };
    const defaults = { ...initial, configOptions: [option] };
    client.getAcpDefaults.mockResolvedValue(defaults);
    client.setAcpDefaultConfig.mockImplementation(async () => ({
      ...defaults,
      configOptions: [{ ...option, currentValue: "" }],
    }));
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Panel client={client} />
      </QueryClientProvider>,
    );
    await screen.getByRole("combobox", { name: "回复详细程度", exact: true }).click();
    await page.getByRole("option", { name: "默认", exact: true }).click();
    await screen.getByRole("heading").click();
    await expect.poll(() => client.setAcpDefaultConfig.mock.calls.length).toBe(1);
    expect(client.setAcpDefaultConfig.mock.calls[0]?.slice(0, 3)).toEqual([
      "codex",
      "verbosity",
      "",
    ]);
    await expect
      .element(screen.getByRole("combobox", { name: "回复详细程度", exact: true }))
      .toHaveTextContent("默认");
    await screen.unmount();
  });
  it(`${platform}：只读渲染不自动保存`, async () => {
    const client = clientFixture();
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Panel client={client} />
      </QueryClientProvider>,
    );
    await expect.element(screen.getByRole("switch", { name: "快速模式" })).toBeVisible();
    await screen.unmount();
    expect(client.setAcpDefaultConfig).not.toHaveBeenCalled();
  });
}
