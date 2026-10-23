import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import "@codexly/ui/core/document-workspace.css";

async function fixture() {
  const host = document.createElement("div");
  host.style.cssText = "width:400px;height:240px;display:flex";
  document.body.append(host);
  const root = createRoot(host);
  let workspace: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
  let renders = 0;
  function View() {
    const state = useDocumentWorkspace<{ id: string }>("scroll");
    useLayoutEffect(() => { workspace = state; renders += 1; });
    return <DocumentWorkspace workspace={state} locale="zh-CN"
      describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })}
      renderDocument={(doc) => <div>{doc.id}</div>}><textarea /></DocumentWorkspace>;
  }
  flushSync(() => root.render(<View />));
  flushSync(() => {
    for (let index = 0; index < 12; index += 1) void workspace.open({ id: `document-${String(index)}.tsx` });
  });
  await expect.poll(() => host.querySelectorAll('[role="tab"]').length).toBe(13);
  const list = host.querySelector<HTMLDivElement>('[role="tablist"]')!;
  const centerError = () => {
    const tab = list.querySelector('[aria-selected="true"]')!.parentElement!.getBoundingClientRect();
    const viewport = list.getBoundingClientRect();
    const chatWidth = list.querySelector<HTMLElement>('[data-chat="true"]')!.offsetWidth;
    return Math.abs((tab.left + tab.right - viewport.left - viewport.right - chatWidth) / 2);
  };
  return { host, list, centerError, renders: () => renders,
    select: (id: string | null) => flushSync(() => { void workspace.select(id); }),
    dispose: () => { flushSync(() => root.unmount()); host.remove(); },
  };
}

describe("中栏标签滚动", () => {
  it("对照和更多操作固定在右侧，滚动标签、窄分屏和切回聊天都不隐藏操作", async () => {
    const view = await fixture();
    const assertFixed = () => {
      const buttons = [...view.host.querySelectorAll<HTMLButtonElement>('.document-workspace-actions button')];
      expect(buttons).toHaveLength(3);
      const viewport = view.host.getBoundingClientRect();
      const actions = view.host.querySelector('.document-workspace-actions')!.getBoundingClientRect();
      expect(actions.right).toBeLessThanOrEqual(viewport.right);
      expect(viewport.right - actions.right).toBeLessThanOrEqual(7);
      expect(view.list.getBoundingClientRect().right).toBeLessThanOrEqual(actions.left);
      for (const button of buttons) {
        const bounds = button.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
        expect(bounds.right).toBeLessThanOrEqual(viewport.right);
        expect(bounds.width).toBeGreaterThanOrEqual(24);
      }
      return actions.left;
    };
    try {
      const initialLeft = assertFixed();
      view.list.scrollLeft = 0;
      expect(assertFixed()).toBe(initialLeft);
      view.list.dispatchEvent(new WheelEvent("wheel", { deltaY: 500, bubbles: true, cancelable: true }));
      expect(assertFixed()).toBe(initialLeft);
      view.host.style.width = "180px";
      assertFixed();
      view.select(null);
      assertFixed();
      expect(view.host.querySelector('button[aria-label="与聊天左右对照"]')?.hasAttribute("disabled")).toBe(true);
    } finally { view.dispose(); }
  });
  it("鼠标滚轮双向滚动且不触发 React 重渲染，缩放手势继续交给浏览器", async () => {
    const view = await fixture();
    try {
      expect(view.list.scrollWidth).toBeGreaterThan(view.list.clientWidth);
      view.list.scrollLeft = 0;
      const renders = view.renders();
      const wheel = new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true });
      view.list.dispatchEvent(wheel);
      expect(view.list.scrollLeft).toBeGreaterThan(0);
      expect(wheel.defaultPrevented).toBe(true);
      const previous = view.list.scrollLeft;
      view.list.dispatchEvent(new WheelEvent("wheel", { deltaY: -60, bubbles: true, cancelable: true }));
      expect(view.list.scrollLeft).toBeLessThan(previous);
      const horizontalStart = view.list.scrollLeft;
      view.list.dispatchEvent(new WheelEvent("wheel", { deltaX: 80, bubbles: true, cancelable: true }));
      expect(view.list.scrollLeft).toBeGreaterThan(horizontalStart);
      const zoom = new WheelEvent("wheel", { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true });
      view.list.dispatchEvent(zoom);
      expect(zoom.defaultPrevented).toBe(false);
      expect(view.renders()).toBe(renders);
    } finally { view.dispose(); }
  });

  it("切换标签、重复点击与调整宽度后居中显示完整标签", async () => {
    const view = await fixture();
    try {
      view.select("document-5.tsx");
      expect(view.centerError()).toBeLessThan(2);
      view.list.scrollLeft = 0;
      flushSync(() => view.list.querySelector<HTMLButtonElement>('[aria-selected="true"]')!.click());
      expect(view.centerError()).toBeLessThan(2);
      view.host.style.width = "300px";
      await expect.poll(view.centerError).toBeLessThan(2);
      expect(view.list.scrollHeight).toBeLessThanOrEqual(view.list.clientHeight);
    } finally { view.dispose(); }
  });
});
