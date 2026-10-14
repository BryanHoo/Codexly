import type * as React from "react";
import {
  createContext,
  createElement,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitWorkspaceChinese } from "@codexly/frontend-core/split-workspace-labels";
import { SplitLayoutMenu } from "@codexly/ui/core/split-layout-menu";

type EventHandlers = Record<string, (event: unknown) => void>;
const state = vi.hoisted(() => ({
  open: false,
  enabled: true,
  count: 1,
  refIndex: 0,
  refs: [] as RefObject<unknown>[],
  buttons: new Map<string, EventHandlers>(),
  content: undefined as EventHandlers | undefined,
  applyPreset: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof React>();
  return {
    ...react,
    // 只在 Node 中驱动菜单状态和引用，测试真实事件处理与定时器，不启动浏览器。
    useState: () => [
      state.open,
      (open: boolean) => {
        state.open = open;
      },
    ],
    useRef: (initial: unknown) => {
      const index = state.refIndex++;
      return (state.refs[index] ??= { current: initial });
    },
  };
});
vi.mock("@codexly/ui/core/split-workspace", () => ({
  SplitPaneContext: createContext(null),
  useSplitWorkspaceState: () => ({
    enabled: state.enabled,
    panes: Array(state.count).fill({ projectId: "project" }),
  }),
  useSplitWorkspaceActions: () => ({ applyPreset: state.applyPreset }),
}));
vi.mock("@codexly/ui/core/button", () => ({
  Button: (props: ComponentProps<"button">) => {
    state.buttons.set(props["aria-label"] ?? "", props as unknown as EventHandlers);
    if (props["aria-label"] === splitWorkspaceChinese.chooseLayout && props.ref) {
      (props.ref as RefObject<unknown>).current = {
        closest: () => ({ getBoundingClientRect: () => ({ width: 1180, height: 640 }) }),
        focus: vi.fn(),
      };
    }
    return createElement("button", { "aria-label": props["aria-label"] }, props.children);
  },
}));
vi.mock("radix-ui/popover", () => ({
  Root: ({ children }: { children: ReactNode }) => children,
  Trigger: ({ children }: { children: ReactNode }) => children,
  Portal: ({ children }: { children: ReactNode }) => children,
  Content: (props: { children: ReactNode }) => {
    state.content = props as unknown as EventHandlers;
    return createElement("div", { role: "menu" }, props.children);
  },
}));

function render() {
  state.refIndex = 0;
  return renderToStaticMarkup(<SplitLayoutMenu labels={splitWorkspaceChinese} />);
}
function handler(label: string, name: string) {
  const handler = state.buttons.get(label)?.[name];
  if (handler === undefined) throw new Error(`缺少事件：${label} ${name}`);
  return handler;
}

describe("分屏布局菜单", () => {
  beforeEach(() => {
    state.open = false;
    state.enabled = true;
    state.count = 1;
    state.refs = [];
    state.buttons.clear();
    state.content = undefined;
    state.applyPreset.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("悬停延迟展开且保留输入焦点，跨过间隙进入菜单不关闭，离开后关闭", () => {
    render();
    handler("分屏布局", "onPointerEnter")({ pointerType: "mouse" });
    vi.advanceTimersByTime(120);
    expect(state.open).toBe(true);
    handler("分屏布局", "onPointerLeave")({});
    const markup = render();
    expect(markup).toContain("双分屏");
    expect(markup).toContain("三分屏");
    expect(markup).toContain("四分屏");
    expect(state.buttons.size).toBe(13);
    const preventDefault = vi.fn();
    state.content?.["onOpenAutoFocus"]?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    state.content?.["onPointerEnter"]?.({});
    vi.advanceTimersByTime(200);
    expect(state.open).toBe(true);
    state.content?.["onPointerLeave"]?.({});
    vi.advanceTimersByTime(200);
    expect(state.open).toBe(false);
  });

  it("选择按中栏实际尺寸传递预设，关闭菜单且不恢复即将隐藏的入口焦点", () => {
    state.open = true;
    render();
    handler("四分屏 · 自适应", "onClick")({});
    expect(state.applyPreset).toHaveBeenCalledExactlyOnceWith(4, "auto", {
      width: 1180,
      height: 640,
    });
    expect(state.open).toBe(false);
    const preventDefault = vi.fn();
    state.content?.["onCloseAutoFocus"]?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("触摸不触发悬停；方向键主动打开菜单时允许获得焦点", () => {
    render();
    handler("分屏布局", "onPointerEnter")({ pointerType: "touch" });
    vi.advanceTimersByTime(120);
    expect(state.open).toBe(false);
    const preventDefault = vi.fn();
    handler("分屏布局", "onKeyDown")({ key: "ArrowDown", preventDefault });
    expect(state.open).toBe(true);
    render();
    preventDefault.mockClear();
    state.content?.["onOpenAutoFocus"]?.({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("移动端或已经分屏时隐藏入口", () => {
    state.enabled = false;
    expect(render()).toBe("");
    state.enabled = true;
    state.count = 2;
    expect(render()).toBe("");
  });
});
