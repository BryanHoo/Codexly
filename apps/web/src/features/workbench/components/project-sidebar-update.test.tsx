import type { ComponentProps } from "react";
import type * as ButtonModule from "../../../shared/components/core/button.js";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { changeAppLanguage } from "../../../i18n/i18n.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { SidebarSettingsButton } from "./project-sidebar-actions.js";

const buttons = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@codexly/ui/core/button", async (original) => {
  const { Button } = await original<typeof ButtonModule>();
  return {
    Button: (props: ComponentProps<typeof Button>) => {
      if (props.id && props.onClick) buttons.set(props.id, () => props.onClick?.({} as never));
      return <Button {...props} />;
    },
  };
});

// 此处仅验证业务回调；Radix 的真实点击与焦点行为由浏览器回归覆盖。
vi.mock("@codexly/ui/core/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => children,
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));

const appInfo = {
  appVersion: "1.3.0",
  codexVersion: "0.163.0",
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
      <TooltipProvider>
        <SidebarSettingsButton
          appInfo={appInfo}
          connectionState="connected"
          onOpen={onOpen}
          onUpdate={onUpdate}
        />
      </TooltipProvider>,
    );
    const openUpdate = buttons.get("app-update-trigger");
    expect(openUpdate).toBeTypeOf("function");
    openUpdate?.();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("版本始终打开关于，设置入口打开外观", () => {
    const onOpen = vi.fn();
    renderToStaticMarkup(
      <TooltipProvider>
        <SidebarSettingsButton
          appInfo={{ ...appInfo, updateAvailable: false, status: "current" }}
          connectionState="connected"
          onOpen={onOpen}
          onUpdate={vi.fn()}
        />
      </TooltipProvider>,
    );
    buttons.get("global-settings-about-trigger")?.();
    buttons.get("global-settings-trigger")?.();
    expect(onOpen.mock.calls).toEqual([["about"], ["appearance"]]);
  });
});
