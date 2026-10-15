import type { ComponentProps } from "react";
import type * as ButtonModule from "../../../shared/components/core/button.js";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { SidebarSettingsButton } from "./project-sidebar-actions.js";

const buttons = vi.hoisted(() => new Map<string, () => void>());
vi.mock("../../../shared/components/core/button.js", async (original) => {
  const { Button } = await original<typeof ButtonModule>();
  return {
    Button: (props: ComponentProps<typeof Button>) => {
      if (props.id && props.onClick) buttons.set(props.id, () => props.onClick?.({} as never));
      return <Button {...props} />;
    },
  };
});

const appInfo = {
  appVersion: "1.3.0",
  codexVersion: "0.162.0",
  latestVersion: "1.4.0",
  releaseNotes: "### 新增\n\n- 支持更新日志弹窗。",
  status: "available" as const,
  updateAvailable: true,
};

describe("左栏更新入口", () => {
  beforeEach(async () => {
    buttons.clear();
    await changeAppLanguage("zh-CN");
  });

  it("点击更新入口不跳转设置，也不会立即安装", () => {
    const onOpen = vi.fn();
    const onUpdate = vi.fn();
    renderToStaticMarkup(
      <SidebarSettingsButton
        appInfo={appInfo}
        connectionState="connected"
        onOpen={onOpen}
        onUpdate={onUpdate}
      />,
    );
    const openUpdate = buttons.get("global-settings-about-trigger");
    expect(openUpdate).toBeTypeOf("function");
    openUpdate?.();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("没有更新时版本入口仍打开关于，设置入口仍打开外观", () => {
    const onOpen = vi.fn();
    renderToStaticMarkup(
      <SidebarSettingsButton
        appInfo={{ ...appInfo, updateAvailable: false, status: "current" }}
        connectionState="connected"
        onOpen={onOpen}
        onUpdate={vi.fn()}
      />,
    );
    buttons.get("global-settings-about-trigger")?.();
    buttons.get("global-settings-trigger")?.();
    expect(onOpen.mock.calls).toEqual([["about"], ["appearance"]]);
  });
});
