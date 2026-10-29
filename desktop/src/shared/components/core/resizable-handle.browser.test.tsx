import { createRef, Profiler, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchPanelResizer } from "@/features/workbench/components/workbench-panel-resizer";
import { DocumentWorkspaceResizer } from "@codexly/ui/core/document-workspace-resizer";
import "@codexly/ui/core/document-workspace.css";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function mockPointerCapture(handle: HTMLDivElement) {
  // 合成事件无法建立浏览器真实指针，因此仅模拟捕获；布局与 React 更新仍在真实浏览器执行。
  let capture: number | null = null;
  vi.spyOn(handle, "setPointerCapture").mockImplementation((id) => { capture = id; });
  vi.spyOn(handle, "hasPointerCapture").mockImplementation((id) => capture === id);
  vi.spyOn(handle, "releasePointerCapture").mockImplementation(() => { capture = null; });
}

function mountSidebar(direction: 1 | -1 = 1) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const preview = vi.fn((width: number) => host.style.setProperty("--width", `${width}px`));
  const end = vi.fn();
  const rendered = vi.fn();
  function View() {
    const [width, setWidth] = useState(300);
    return <WorkbenchPanelResizer direction={direction} label="调整面板" panel="sidebar"
      width={width} minimumWidth={200} maximumWidth={500}
      onResize={preview} onResizeStart={() => { host.dataset.resizing = "true"; }}
      onResizeEnd={(next) => { delete host.dataset.resizing; end(next); setWidth(next); }} />;
  }
  flushSync(() => root.render(<Profiler id="面板" onRender={rendered}><View /></Profiler>));
  const handle = host.querySelector<HTMLDivElement>('[role="separator"]')!;
  mockPointerCapture(handle);
  return {
    host, handle, preview, end, renders: () => rendered.mock.calls.length,
    pointer(type: string, clientX: number, pointerId = 1) {
      flushSync(() => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientX, pointerId })));
    },
    key(key: string, ctrlKey = false) {
      flushSync(() => handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key, ctrlKey })));
    },
    unmount() { flushSync(() => root.unmount()); },
    destroy() { flushSync(() => root.unmount()); host.remove(); },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("双端共享分隔条交互", () => {
  it("拖动按帧预览且不重渲染，松手使用最终坐标并只提交一次", async () => {
    const view = mountSidebar();
    try {
      view.pointer("pointerdown", 100);
      expect(document.activeElement).toBe(view.handle);
      view.pointer("pointermove", 110);
      view.pointer("pointermove", 125);
      view.pointer("pointermove", 140);
      expect(view.preview).not.toHaveBeenCalled();
      await nextFrame();
      expect(view.preview).toHaveBeenCalledTimes(1);
      expect(view.preview).toHaveBeenLastCalledWith(340);
      expect(view.handle.getAttribute("aria-valuenow")).toBe("340");
      expect(view.renders()).toBe(1);
      view.pointer("pointerup", 160);
      expect(view.end).toHaveBeenCalledExactlyOnceWith(360);
      expect(view.host.dataset.resizing).toBeUndefined();
      expect(view.renders()).toBe(2);
      view.pointer("lostpointercapture", 160);
      expect(view.end).toHaveBeenCalledTimes(1);
    } finally { view.destroy(); }
  });

  it.each(["pointercancel", "lostpointercapture", "blur", "Escape", "resize", "unmount"])("%s 取消恢复宽度并释放待处理帧", async (reason) => {
    const view = mountSidebar();
    try {
      view.pointer("pointerdown", 100);
      view.pointer("pointermove", 160);
      await nextFrame();
      expect(view.host.style.getPropertyValue("--width")).toBe("360px");
      view.pointer("pointermove", 180);
      if (reason === "Escape") view.key(reason);
      else if (reason === "blur" || reason === "resize") flushSync(() => window.dispatchEvent(new Event(reason)));
      else if (reason === "unmount") view.unmount();
      else view.pointer(reason, 180);
      await nextFrame();
      expect(view.preview).toHaveBeenLastCalledWith(300);
      expect(view.end).toHaveBeenCalledExactlyOnceWith(300);
      expect(view.host.dataset.resizing).toBeUndefined();
    } finally { view.destroy(); }
  });

  it("右栏反向拖动，忽略其他指针并夹取像素边界", () => {
    const view = mountSidebar(-1);
    try {
      view.pointer("pointerdown", 100);
      view.pointer("pointerdown", 50, 2);
      view.pointer("pointermove", 0, 2);
      view.pointer("pointerup", 0, 2);
      expect(view.end).not.toHaveBeenCalled();
      view.pointer("pointerup", -300);
      expect(view.end).toHaveBeenCalledExactlyOnceWith(500);
    } finally { view.destroy(); }
  });

  it("方向键和 Home/End 遵守边界，不抢占组合快捷键", () => {
    const view = mountSidebar(-1);
    try {
      view.key("ArrowLeft");
      expect(view.end).toHaveBeenLastCalledWith(308);
      view.key("Home");
      expect(view.end).toHaveBeenLastCalledWith(200);
      view.key("ArrowRight");
      expect(view.end).toHaveBeenLastCalledWith(200);
      view.key("End");
      expect(view.end).toHaveBeenLastCalledWith(500);
      const count = view.end.mock.calls.length;
      view.key("ArrowLeft", true);
      expect(view.end).toHaveBeenCalledTimes(count);
    } finally { view.destroy(); }
  });
});

describe("文档对照分隔条", () => {
  function mountDocument(direction: "right" | "down") {
    const host = document.createElement("div");
    host.className = "document-workspace-body";
    host.dataset.direction = direction;
    host.style.cssText = "width:800px;height:400px;flex:none";
    const ref = createRef<HTMLDivElement>();
    ref.current = host;
    document.body.append(host);
    const root = createRoot(host);
    const render = (nextDirection: "right" | "down") => flushSync(() => root.render(<>
      <div className="document-workspace-chat"><textarea defaultValue="保留草稿" /></div>
      <div className="document-workspace-document" />
      <DocumentWorkspaceResizer direction={nextDirection} containerRef={ref} label="调整对照" />
    </>));
    render(direction);
    const handle = host.querySelector<HTMLDivElement>('[role="separator"]')!;
    const editor = host.querySelector("textarea")!;
    mockPointerCapture(handle);
    const rect = host.getBoundingClientRect();
    const start = direction === "right" ? rect.left + 403 : rect.top + 203;
    return {
      host, handle, editor, render,
      ratio: () => Number.parseFloat(host.style.getPropertyValue("--document-split-ratio") || "50"),
      pointer(type: string, offset: number) {
        flushSync(() => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0,
          clientX: direction === "right" ? start + offset : 0,
          clientY: direction === "down" ? start + offset : 0 })));
      },
      key(key: string) { flushSync(() => handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }))); },
      destroy() { flushSync(() => root.unmount()); host.remove(); },
    };
  }

  it.each(["right", "down"] as const)("%s 对照保持抓取偏移，实时同步语义且不重新挂载草稿", async (direction) => {
    const view = mountDocument(direction);
    try {
      view.pointer("pointerdown", 0);
      view.pointer("pointermove", 0);
      await nextFrame();
      expect(view.ratio()).toBe(50);
      view.pointer("pointermove", direction === "right" ? 80 : 40);
      await nextFrame();
      expect(view.ratio()).toBe(60);
      expect(view.handle.getAttribute("aria-valuenow")).toBe("60");
      view.pointer("pointerup", direction === "right" ? 160 : 80);
      expect(view.ratio()).toBe(70);
      expect(view.handle.getAttribute("aria-valuenow")).toBe("70");
      expect(view.host.querySelector("textarea")).toBe(view.editor);
      expect(view.editor.value).toBe("保留草稿");
    } finally { view.destroy(); }
  });

  it("取消恢复原比例，键盘限制比例，双击恢复等分", async () => {
    const view = mountDocument("right");
    try {
      view.key("ArrowRight");
      expect(view.ratio()).toBe(55);
      view.pointer("pointerdown", 0);
      view.pointer("pointermove", 80);
      await nextFrame();
      expect(view.ratio()).toBe(65);
      view.pointer("pointercancel", 80);
      expect(view.ratio()).toBe(55);
      view.key("End");
      expect(view.ratio()).toBe(75);
      view.key("ArrowRight");
      expect(view.ratio()).toBe(75);
      view.key("Home");
      expect(view.ratio()).toBe(25);
      flushSync(() => view.handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
      expect(view.ratio()).toBe(50);
    } finally { view.destroy(); }
  });

  it("方向切换取消旧拖动并清除待处理预览", async () => {
    const view = mountDocument("right");
    try {
      view.pointer("pointerdown", 0);
      view.pointer("pointermove", 80);
      await nextFrame();
      view.pointer("pointermove", 160);
      view.render("down");
      await nextFrame();
      expect(view.ratio()).toBe(50);
      expect(view.handle.getAttribute("aria-valuenow")).toBe("50");
      expect(view.handle.hasPointerCapture(1)).toBe(false);
    } finally { view.destroy(); }
  });
});
