import "../../../apps/web/src/shared/styles/globals.css";
import { changeAppLanguage as webLanguage } from "../../../apps/web/src/i18n/i18n.js";
import { changeAppLanguage as desktopLanguage } from "../../src/i18n/i18n.js";
import { beforeEach } from "vitest";
beforeEach(async () => {
  await webLanguage("zh-CN");
  await desktopLanguage("zh-CN");
});
import {
  SettingsGroup,
  SettingsField,
  SettingsSelect,
} from "../../../apps/web/src/features/settings/components/global-settings-fields.js";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  NetworkProxySettingsPanel,
  NETWORK_PROXY_LABELS,
} from "@codexly/ui/core/network-proxy-settings";
import "../../src/shared/styles/globals.css";

it("共享代理表单保留密码、支持清除与测试失败重试，并提示重启", async () => {
  const settings = {
    mode: "custom" as const,
    protocol: "http" as const,
    host: "127.0.0.1",
    port: 8080,
    username: "user",
    hasPassword: true,
  };
  const save = vi.fn(async () => ({ ...settings, hasPassword: false }));
  const test = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const screen = await render(
    <NetworkProxySettingsPanel
      components={{ Group: SettingsGroup, Field: SettingsField, Select: SettingsSelect }}
      read={async () => settings}
      save={save}
      test={test}
      labels={NETWORK_PROXY_LABELS["zh-CN"]}
    />,
  );
  await expect.element(screen.getByRole("textbox", { name: "密码（可选）" })).toBeVisible();
  const password = screen.container.querySelector('input[type="password"]') as HTMLInputElement;
  await expect.poll(() => password.placeholder).toBe("已保存，留空保留");
  expect(password.value).toBe("");
  await screen.getByRole("button", { name: "测试连接" }).click();
  await expect.element(screen.getByText("操作失败，请检查代理配置与网络后重试")).toBeVisible();
  await screen.getByRole("button", { name: "测试连接" }).click();
  await expect.element(screen.getByText("连接成功")).toBeVisible();
  await screen.getByRole("checkbox", { name: "清除已保存密码" }).click();
  await screen.getByRole("button", { name: "保存代理设置" }).click();
  await expect.element(screen.getByText("已保存，请重启应用或 Web 服务")).toBeVisible();
  expect(save.mock.calls[0]).toEqual([
    {
      mode: "custom",
      protocol: "http",
      host: "127.0.0.1",
      port: 8080,
      username: "user",
      password: "",
    },
  ]);
});

import { useState } from "react";
import { page } from "vitest/browser";
import { afterEach } from "vitest";
import { SettingsPageFrame as WebFrame } from "../../../apps/web/src/features/settings/components/settings-page-frame.js";
import { SettingsPageFrame as DesktopFrame } from "../../src/features/settings/components/settings-page-frame.js";
import {
  SettingsGroup as DesktopGroup,
  SettingsField as DesktopField,
  SettingsSelect as DesktopSelect,
} from "../../src/features/settings/components/global-settings-fields.js";
const values = {
  mode: "system" as const,
  protocol: "http" as const,
  host: "",
  port: 8080,
  username: "",
  hasPassword: false,
};
const readValues = async () => values;
function NavigationHarness({ desktop }: { desktop: boolean }) {
  const [section, setSection] = useState<"appearance" | "network">("appearance");
  const Frame = desktop ? DesktopFrame : WebFrame;
  const components = desktop
    ? { Group: DesktopGroup, Field: DesktopField, Select: DesktopSelect }
    : { Group: SettingsGroup, Field: SettingsField, Select: SettingsSelect };
  return (
    <div style={{ height: 800 }}>
      <Frame
        activeSection={section}
        onSectionChange={(next) => {
          if (next === "network" || next === "appearance") setSection(next);
        }}
        onBack={() => {}}
      >
        {section === "network" ? (
          <NetworkProxySettingsPanel
            components={components}
            labels={NETWORK_PROXY_LABELS["zh-CN"]}
            read={readValues}
            save={async () => values}
            test={async () => {}}
          />
        ) : (
          <h1>常规页面</h1>
        )}
      </Frame>
    </div>
  );
}
afterEach(async () => {
  document.documentElement.removeAttribute("data-theme");
  await page.viewport(1440, 900);
});
it.each([false, true])("实际设置导航可搜索网络且常规没有代理，desktop=%s", async (desktop) => {
  const screen = await render(<NavigationHarness desktop={desktop} />);
  expect(screen.container.querySelector("#settings-panel-network")).toBeNull();
  await screen.getByRole("searchbox", { name: "搜索设置" }).fill("代理");
  await screen.getByRole("button", { name: "网络", exact: true }).click();
  await expect.element(screen.getByRole("combobox", { name: "连接方式" })).toHaveValue("system");
  await expect.element(screen.getByRole("button", { name: "保存代理设置" })).toBeDisabled();
  await screen.getByRole("combobox", { name: "连接方式" }).selectOptions("custom");
  await expect.element(screen.getByRole("textbox", { name: "网关地址" })).toBeVisible();
  expect(screen.container.querySelector('input[data-slot="input"]')).not.toBeNull();
  await screen.getByRole("combobox", { name: "连接方式" }).selectOptions("direct");
  await expect.element(screen.getByRole("textbox", { name: "网关地址" })).not.toBeInTheDocument();
});
it.each(
  [false, true].flatMap((desktop) =>
    [390, 1280].flatMap((width) => [false, true].map((dark) => ({ desktop, width, dark }))),
  ),
)("两端明暗宽窄布局 $desktop/$width/$dark", async ({ desktop, width, dark }) => {
  await page.viewport(width, 900);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  const components = desktop
    ? { Group: DesktopGroup, Field: DesktopField, Select: DesktopSelect }
    : { Group: SettingsGroup, Field: SettingsField, Select: SettingsSelect };
  const screen = await render(
    <div style={{ maxWidth: 800, padding: 20 }}>
      <NetworkProxySettingsPanel
        components={components}
        labels={NETWORK_PROXY_LABELS["zh-CN"]}
        read={async () => ({ ...values, mode: "custom", host: "127.0.0.1" })}
        save={async () => values}
        test={async () => {}}
      />
    </div>,
  );
  await expect.element(screen.getByRole("textbox", { name: "网关地址" })).toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  const input = screen.container.querySelector('input[data-slot="input"]') as HTMLElement;
  expect(input.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
  expect(getComputedStyle(input).borderRadius).not.toBe("0px");
});
