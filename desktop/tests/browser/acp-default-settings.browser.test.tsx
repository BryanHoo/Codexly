import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { AcpDefaults } from "@codexly/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentSettingsPanel as WebPanel } from "../../../apps/web/src/features/settings/components/agent-settings-panel.js";
import { AgentSettingsPanel as DesktopPanel } from "../../src/features/settings/components/agent-settings-panel.js";
import { changeAppLanguage as changeWebLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as changeDesktopLanguage } from "../../src/i18n/i18n.js";
import "../../src/shared/styles/globals.css";

const initial: AcpDefaults = {
  configOptions: [
    {
      id: "native-model",
      name: "原生模型",
      type: "select",
      currentValue: "a",
      options: [
        { value: "a", name: "模型甲" },
        { value: "b", name: "模型乙" },
      ],
    },
    { id: "native-switch", name: "原生开关", type: "boolean", currentValue: false },
  ],
  defaults: {},
  unmappedLegacy: ["旧偏好"],
  invalidDefaults: [],
};
beforeEach(async () => {
  await changeWebLanguage("zh-CN");
  await changeDesktopLanguage("zh-CN");
});
for (const [platform, Panel] of [
  ["web", WebPanel],
  ["desktop", DesktopPanel],
] as const) {
  it(`${platform}：实际设置页使用 ACP 单项变更与完整返回配置`, async () => {
    let resolve!: (value: AcpDefaults) => void;
    const client = {
      getAcpDefaults: vi.fn(() => Promise.resolve(initial)),
      setAcpDefaultConfig: vi.fn(
        () =>
          new Promise<AcpDefaults>((done) => {
            resolve = done;
          }),
      ),
    };
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Panel client={client} />
      </QueryClientProvider>,
    );
    const model = screen.getByRole("combobox", { name: "原生模型" });
    await expect.element(model).toHaveValue("a");
    await expect.element(screen.getByRole("checkbox", { name: "原生开关" })).not.toBeChecked();
    await expect.element(screen.getByText(/旧偏好/)).toBeVisible();
    await model.selectOptions("b");
    await expect.element(model).toBeDisabled();
    expect(client.setAcpDefaultConfig).toHaveBeenCalledWith(
      "codex",
      "native-model",
      "b",
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    resolve({
      ...initial,
      configOptions: [{ ...initial.configOptions[0]!, currentValue: "b" }],
      defaults: { "native-model": "b" },
    });
    await expect.element(model).toHaveValue("b");
    await expect.element(screen.getByRole("checkbox")).not.toBeInTheDocument();
    await screen.unmount();
  });
  it(`${platform}：保存失败保留原配置，重试复用键`, async () => {
    const client = {
      getAcpDefaults: vi.fn(() => Promise.resolve(initial)),
      setAcpDefaultConfig: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ ...initial, configOptions: [] }),
    };
    const screen = await render(
      <QueryClientProvider client={new QueryClient()}>
        <Panel client={client} />
      </QueryClientProvider>,
    );
    const model = screen.getByRole("combobox", { name: "原生模型" });
    await model.selectOptions("b");
    await expect.element(screen.getByRole("alert")).toHaveTextContent("offline");
    await expect.element(model).toHaveValue("a");
    const first = client.setAcpDefaultConfig.mock.calls[0]![3];
    await screen.getByRole("button", { name: "重试", exact: true }).click();
    await expect.element(model).not.toBeInTheDocument();
    expect(client.setAcpDefaultConfig.mock.calls[1]![3].idempotencyKey).toBe(first.idempotencyKey);
    await screen.unmount();
  });
  it(`${platform}：切换引擎隔离旧保存响应`, async () => {
    let resolve!: (value: AcpDefaults) => void;
    const client = {
      getAcpDefaults: vi.fn((engine: string) =>
        Promise.resolve(engine === "codex" ? initial : { ...initial, configOptions: [] }),
      ),
      setAcpDefaultConfig: vi.fn(
        () =>
          new Promise<AcpDefaults>((done) => {
            resolve = done;
          }),
      ),
    };
    const queryClient = new QueryClient();
    const view = (engine: "codex" | "claude") => (
      <QueryClientProvider client={queryClient}>
        <Panel client={client} engine={engine} />
      </QueryClientProvider>
    );
    const screen = await render(view("codex"));
    const model = screen.getByRole("combobox", { name: "原生模型" });
    await model.selectOptions("b");
    await expect.element(model).toBeDisabled();
    await screen.rerender(view("claude"));
    await expect
      .element(screen.getByText("智能体未提供可配置选项。", { exact: true }))
      .toBeVisible();
    const saved = { ...initial, defaults: { "native-model": "b" } };
    resolve(saved);
    await expect.poll(() => queryClient.getQueryData(["acp-defaults", "codex"])).toEqual(saved);
    await expect.element(model).not.toBeInTheDocument();
    await screen.unmount();
  });
}
