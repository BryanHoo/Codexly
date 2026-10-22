import { memo, useContext, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { SplitPaneControls } from "@codexly/ui/core/split-pane-controls";
import {
  SplitPaneContext,
  SplitWorkspaceGrid,
  SplitWorkspaceProvider,
  useSplitWorkspace,
} from "@codexly/ui/core/split-workspace";
import "@codexly/ui/core/split-workspace.css";

const first = { projectId: "project", taskId: "first" };
const second = { projectId: "project", taskId: "second" };
const toggleSidebar = () => undefined;
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.useRealTimers();
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

function setup(desktop = true) {
  const host = document.createElement("div");
  host.style.cssText = "display:grid;width:800px;height:480px";
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    flushSync(() => root.unmount());
    host.remove();
  });
  let workspace: NonNullable<ReturnType<typeof useSplitWorkspace>>;
  const renders = [0];
  let commits = 0;
  const Pane = memo(function Pane() {
    const pane = useContext(SplitPaneContext)!;
    renders[0] = (renders[0] ?? 0) + 1;
    return (
      <>
        <header className="workbench-pane-header">
          <SplitPaneControls
            closeLabel="关闭"
            soloLabel="独显"
            dragLabel="交换位置"
            dragHint="长按拖动，或依次点击两个窗口的图标交换位置；Esc 取消"
            draggingLabel="正在拖移窗口"
            dropLabel="松开交换位置"
          />
        </header>
        <textarea aria-label={pane.pane.taskId} defaultValue="未发送草稿" />
      </>
    );
  });
  function View() {
    const value = useSplitWorkspace()!;
    useLayoutEffect(() => {
      workspace = value;
      commits += 1;
    });
    return (
      <SplitWorkspaceGrid
        label="分屏"
        sidebarOpen
        toggleSidebar={toggleSidebar}
        splitLabels={{ up: "上", down: "下", left: "左", right: "右", limit: "满" }}
      >
        {() => <Pane />}
      </SplitWorkspaceGrid>
    );
  }
  flushSync(() =>
    root.render(
      <SplitWorkspaceProvider current={first} routeKey="first" desktop={desktop}>
        <View />
      </SplitWorkspaceProvider>,
    ),
  );
  flushSync(() => workspace.add(second));
  flushSync(() => workspace.focus(first));
  const container = host.querySelector<HTMLDivElement>(".split-workspace")!;
  const panes = [...host.querySelectorAll<HTMLElement>("[data-split-pane]")];
  const handles = [...host.querySelectorAll<HTMLButtonElement>("[data-split-drag-handle]")];
  expect(handles).toHaveLength(2);
  // 合成事件不创建系统级活动指针，仅替换捕获原语，真实命中、定时器及 React 更新仍由浏览器执行。
  for (const handle of handles) {
    let captured = false;
    vi.spyOn(handle, "setPointerCapture").mockImplementation(() => {
      captured = true;
    });
    vi.spyOn(handle, "hasPointerCapture").mockImplementation(() => captured);
    vi.spyOn(handle, "releasePointerCapture").mockImplementation(() => {
      captured = false;
    });
  }
  const rects = panes.map((pane) => pane.getBoundingClientRect());
  const editors = [...host.querySelectorAll("textarea")];
  editors[0]!.value = "保留草稿";
  const pointer = (
    type: string,
    x = rects[0]!.x + 20,
    y = rects[0]!.y + 20,
    pointerId = 1,
    pointerType = "mouse",
  ) => {
    flushSync(() =>
      handles[0]!.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          pointerId,
          pointerType,
          clientX: x,
          clientY: y,
        }),
      ),
    );
  };
  return {
    host,
    container,
    panes,
    handles,
    rects,
    editors,
    pointer,
    read: () => workspace!,
    unmount: () => flushSync(() => root.unmount()),
    counts: () => ({ renders: renders[0], commits }),
    activate: (pointerType = "mouse") => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      pointer("pointerdown", undefined, undefined, 1, pointerType);
      flushSync(() => vi.advanceTimersByTime(300));
    },
    target: () => ({ x: rects[1]!.x + 40, y: rects[1]!.y + 80 }),
  };
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("共享分屏长按交换", () => {
  it.each([false, true])(
    "拖动仅更新高亮，松开提交一次且保留输入框、草稿与比例（desktop=%s）",
    async (desktop) => {
      const view = setup(desktop);
      const before = view.counts();
      view.activate();
      const { x, y } = view.target();
      for (let index = 0; index < 40; index += 1) view.pointer("pointermove", x + index / 10, y);
      await frame();
      expect(view.panes[1]!.hasAttribute("data-split-drop-target")).toBe(true);
      expect(view.counts()).toEqual(before);
      // 松开前尚未交换，且松开位置即使未经过下一帧也必须生效。
      expect(view.panes[0]!.getBoundingClientRect().x).toBe(view.rects[0]!.x);
      view.pointer("pointerup", x, y);
      expect(view.counts()).toEqual({ renders: before.renders, commits: before.commits + 1 });
      expect(view.panes[0]!.getBoundingClientRect().x).toBe(view.rects[1]!.x);
      expect([...view.host.querySelectorAll("textarea")]).toEqual(view.editors);
      expect(view.editors[0]!.value).toBe("保留草稿");
      expect(view.container.hasAttribute("data-reordering")).toBe(false);
      expect(view.handles[0]!.hasPointerCapture(1)).toBe(false);
    },
  );

  it.each(["touch", "pen"])("长按 %s 输入同样可以交换", (inputType) => {
    const view = setup();
    view.activate(inputType);
    const { x, y } = view.target();
    view.pointer("pointerup", x, y, 1, inputType);
    expect(view.panes[0]!.getBoundingClientRect().x).toBe(view.rects[1]!.x);
  });

  it.each([false, true])("鼠标及触控板直接拖动不必先静止长按（desktop=%s）", async (desktop) => {
    const view = setup(desktop);
    const before = view.counts();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    view.pointer("pointerdown");
    flushSync(() => vi.advanceTimersByTime(30));
    view.pointer("pointermove", view.rects[0]!.x + 55, view.rects[0]!.y + 35);
    expect(view.container.dataset.reordering).toBe("drag");
    const preview = document.querySelector<HTMLElement>(".split-workspace-drag-preview");
    expect(preview?.textContent).toContain("正在拖移窗口");
    expect(view.panes.every((pane) => !pane.hasAttribute("data-split-drop-target"))).toBe(true);
    await frame();
    expect(view.counts()).toEqual(before);
    const { x, y } = view.target();
    view.pointer("pointermove", x, y);
    await frame();
    expect(preview?.textContent).toContain("松开交换位置");
    view.pointer("pointerup", x, y);
    expect(view.panes[0]!.getBoundingClientRect().x).toBe(view.rects[1]!.x);
    expect(document.querySelector(".split-workspace-drag-preview")).toBe(null);
    flushSync(() => vi.advanceTimersByTime(500));
    expect(document.querySelector(".split-workspace-drag-preview")).toBe(null);
  });

  it("长按激活后立即显示跟随指针的反馈，未命中目标和移出工作区时仍然可见", async () => {
    const view = setup();
    view.activate();
    const preview = document.querySelector<HTMLElement>(".split-workspace-drag-preview");
    expect(preview?.textContent).toContain("正在拖移窗口");
    const start = preview?.style.transform;
    view.pointer("pointermove", view.rects[0]!.x + 80, view.rects[0]!.y + 60);
    await frame();
    expect(preview?.style.transform).not.toBe(start);
    expect(preview?.textContent).toContain("正在拖移窗口");
    view.pointer("pointermove", view.rects[1]!.right + 30, view.rects[1]!.bottom + 30);
    await frame();
    expect(preview?.isConnected).toBe(true);
    expect(preview?.textContent).toContain("正在拖移窗口");
    view.pointer("pointerup", -20, -20);
    expect(document.querySelector(".split-workspace-drag-preview")).toBe(null);
  });

  it("触屏长按前移动过远不启动，短按通过两次点击交换，并支持取消", () => {
    const view = setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    view.pointer("pointerdown", undefined, undefined, 1, "touch");
    view.pointer("pointermove", view.rects[0]!.x + 50, view.rects[0]!.y + 20, 1, "touch");
    flushSync(() => vi.advanceTimersByTime(300));
    expect(view.container.hasAttribute("data-reordering")).toBe(false);
    view.pointer("pointerdown");
    view.pointer("pointerup");
    flushSync(() => view.handles[0]!.click());
    expect(view.handles[0]!.getAttribute("aria-pressed")).toBe("true");
    flushSync(() => view.handles[1]!.click());
    expect(view.panes[0]!.getBoundingClientRect().x).toBe(view.rects[1]!.x);
    flushSync(() => view.handles[0]!.click());
    flushSync(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(view.handles[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(view.container.hasAttribute("data-reordering")).toBe(false);
  });

  it.each([
    "Escape",
    "blur",
    "pointercancel",
    "lostpointercapture",
    "resize",
    "scroll",
    "outside",
    "source",
  ])("%s 中止拖动并清理状态", (reason) => {
    const view = setup();
    const before = view.read().layout;
    view.activate();
    const { x, y } = view.target();
    view.pointer("pointermove", x, y);
    if (reason === "Escape")
      window.dispatchEvent(new KeyboardEvent("keydown", { key: reason, bubbles: true }));
    else if (reason === "outside") view.pointer("pointerup", -20, -20);
    else if (reason === "source") view.pointer("pointerup");
    else if (reason.startsWith("pointer") || reason === "lostpointercapture") view.pointer(reason);
    else window.dispatchEvent(new Event(reason));
    expect(view.read().layout).toBe(before);
    expect(view.container.hasAttribute("data-reordering")).toBe(false);
    expect(view.handles[0]!.hasPointerCapture(1)).toBe(false);
    expect(view.panes.every((pane) => !pane.hasAttribute("data-split-drop-target"))).toBe(true);
    expect(document.querySelector(".split-workspace-drag-preview")).toBe(null);
  });

  it("忽略其他指针，并在松开前最后一次移动没有绘制时使用最新落点", () => {
    const view = setup();
    view.activate();
    const { x, y } = view.target();
    view.pointer("pointerup", x, y, 2);
    expect(view.container.hasAttribute("data-reordering")).toBe(true);
    view.pointer("pointerup", x, y);
    expect(view.panes[0]!.getBoundingClientRect().x).toBe(view.rects[1]!.x);
  });

  it("布局变更立即撤销拖动，不允许旧指针改写新布局", () => {
    const view = setup();
    view.activate();
    flushSync(() => view.read().split(first, "down"));
    const layout = view.read().layout;
    const { x, y } = view.target();
    view.pointer("pointerup", x, y);
    expect(view.read().layout).toBe(layout);
    expect(view.read().panes).toHaveLength(3);
    expect(view.container.hasAttribute("data-reordering")).toBe(false);
    expect(view.handles[0]!.hasPointerCapture(1)).toBe(false);
  });

  it("支持键盘选择与交换，完成后清除按下状态", async () => {
    const view = setup();
    view.handles[0]!.focus();
    await userEvent.keyboard("{Enter}");
    expect(view.handles[0]!.getAttribute("aria-pressed")).toBe("true");
    view.handles[1]!.focus();
    await userEvent.keyboard(" ");
    expect(view.panes[0]!.getBoundingClientRect().x).toBe(view.rects[1]!.x);
    expect(view.handles.every((handle) => handle.getAttribute("aria-pressed") === "false")).toBe(
      true,
    );
  });

  it("容器尺寸变化取消缓存命中，卸载时释放捕获与定时器", async () => {
    const view = setup();
    view.activate();
    view.host.style.width = "700px";
    await frame();
    await frame();
    expect(view.container.hasAttribute("data-reordering")).toBe(false);
    expect(view.handles[0]!.hasPointerCapture(1)).toBe(false);
    view.activate();
    view.unmount();
    expect(document.querySelector(".split-workspace-drag-preview")).toBe(null);
    expect(view.handles[0]!.hasPointerCapture(1)).toBe(false);
    expect(view.container.hasAttribute("data-reordering")).toBe(false);
    flushSync(() => vi.advanceTimersByTime(1000));
    expect(view.container.hasAttribute("data-reordering")).toBe(false);
  });

  it("退出分屏隐藏拖拽入口，按压取消后不吞掉新的正文点击", () => {
    const view = setup();
    view.activate();
    window.dispatchEvent(new Event("blur"));
    let clicked = false;
    view.editors[0]!.addEventListener("click", () => {
      clicked = true;
    });
    view.editors[0]!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0 }),
    );
    view.editors[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(clicked).toBe(true);
    flushSync(() => view.read().solo(first));
    expect(view.host.querySelector("[data-split-drag-handle]")).toBe(null);
  });
});
