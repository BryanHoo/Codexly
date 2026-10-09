import type { MouseEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarDraftNavigation } from "@codexly/ui/core/split-draft-navigation";

const { openSplitDraft } = vi.hoisted(() => ({ openSplitDraft: vi.fn() }));
vi.mock("@codexly/ui/core/split-workspace", () => ({
  useOpenSplitDraft: () => openSplitDraft,
}));

type Navigation = ReturnType<typeof useSidebarDraftNavigation>;
function Probe({
  navigate,
  capture,
}: {
  navigate: (projectId: string) => Promise<unknown>;
  capture: (navigation: Navigation) => void;
}) {
  capture(useSidebarDraftNavigation("temporary", navigate));
  return null;
}

function setup() {
  const navigate = vi.fn().mockResolvedValue(undefined);
  let navigation: Navigation | undefined;
  renderToStaticMarkup(
    <Probe
      navigate={navigate}
      capture={(value) => {
        navigation = value;
      }}
    />,
  );
  if (navigation === undefined) throw new Error("Navigation was not rendered");
  return { navigation, navigate };
}

function click(overrides: Partial<MouseEvent<HTMLAnchorElement>> = {}) {
  const preventDefault = vi.fn();
  return {
    preventDefault,
    event: {
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault,
      ...overrides,
    } as unknown as MouseEvent<HTMLAnchorElement>,
  };
}

describe("分屏新建入口导航", () => {
  beforeEach(() => openSplitDraft.mockReset());

  it.each(["temporary", "project"])("在分屏中打开 %s 草稿时不触发整页导航", async (scope) => {
    openSplitDraft.mockReturnValue(true);
    const { navigation, navigate } = setup();
    await navigation.openDraft(scope);
    expect(openSplitDraft).toHaveBeenCalledWith(scope);
    expect(navigate).not.toHaveBeenCalled();
    const { event, preventDefault } = click();
    navigation.onNewTaskClick(event);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("单窗口或移动端继续走平台导航，普通链接保留路由默认行为", async () => {
    openSplitDraft.mockReturnValue(false);
    const { navigation, navigate } = setup();
    await navigation.openDraft("project");
    expect(navigate).toHaveBeenCalledWith("project");
    const { event, preventDefault } = click();
    navigation.onNewTaskClick(event);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it.each([
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
    { defaultPrevented: true },
  ])("修饰键及已处理点击不替换分屏：%o", (overrides) => {
    openSplitDraft.mockReturnValue(true);
    const { navigation } = setup();
    const { event, preventDefault } = click(overrides);
    navigation.onNewTaskClick(event);
    expect(openSplitDraft).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
