import { useLayoutEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { DocumentWorkspace } from "@codexly/ui/core/document-workspace";
import { useDocumentWorkspace } from "@codexly/ui/core/use-document-workspace";
import "@codexly/ui/core/document-workspace.css";

function fixture() {
  const host = document.createElement("div");
  host.style.cssText = "width:360px;height:240px;display:flex";
  document.body.append(host);
  const root = createRoot(host);
  let state: ReturnType<typeof useDocumentWorkspace<{ id: string }>>;
  let mounts = 0;
  let renders = 0;
  function File({ id }: { id: string }) {
    useLayoutEffect(() => { mounts += 1; return () => { mounts -= 1; }; }, []);
    return <div>{id}</div>;
  }
  function View() {
    const workspace = useDocumentWorkspace<{ id: string }>("tabs");
    useLayoutEffect(() => { state = workspace; renders += 1; });
    return <DocumentWorkspace workspace={workspace} locale="zh-CN"
      describe={(doc) => ({ title: doc.id, detail: doc.id, kind: "source" })}
      renderDocument={(doc) => <File id={doc.id} />}><textarea /></DocumentWorkspace>;
  }
  flushSync(() => root.render(<View />));
  const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === name)!;
  const openMenu = (name: string) => flushSync(() => {
    tab(name).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 80, clientY: 30 }));
  });
  const choose = async (name: string) => {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent === name);
    expect(item).toBeDefined();
    flushSync(() => item!.click());
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  return { host, tab, openMenu, choose, state: () => state!, mounts: () => mounts, renders: () => renders,
    open: async (...ids: string[]) => {
      flushSync(() => { for (const id of ids) void state!.open({ id }); });
      await expect.poll(() => host.querySelectorAll('[role="tab"]').length).toBe(state!.documents.length + 1);
    },
    dispose: () => { flushSync(() => root.unmount()); host.remove(); },
  };
}

describe("中栏标签菜单与排序", () => {
  it("仅有聊天隐藏标签栏，打开文档后聊天固定首位且滚动不会隐藏", async () => {
    const view = fixture();
    try {
      expect(view.host.querySelector(".document-workspace-toolbar")).toBeNull();
      await view.open(...Array.from({ length: 12 }, (_, i) => `document-${String(i)}.tsx`));
      const list = view.host.querySelector<HTMLDivElement>('[role="tablist"]')!;
      list.scrollLeft = list.scrollWidth;
      const chat = view.tab("聊天").getBoundingClientRect();
      const bounds = list.getBoundingClientRect();
      expect(chat.left).toBeGreaterThanOrEqual(bounds.left);
      expect(chat.right).toBeLessThanOrEqual(bounds.right);
      expect(view.host.querySelector('[aria-label="回到聊天"]')).toBeNull();
      expect(view.host.querySelector('[data-chat="true"]')?.getAttribute("draggable")).not.toBe("true");
    } finally { view.dispose(); }
  });

  it("右键固定不切换当前文档，批量操作保护固定标签，显式关闭固定项", async () => {
    const view = fixture();
    try {
      await view.open("a", "b", "c", "d");
      view.openMenu("b");
      await view.choose("固定");
      expect(view.state().documents.map((doc) => doc.id)).toEqual(["b", "a", "c", "d"]);
      expect(view.state().activeId).toBe("d");
      expect(view.mounts()).toBe(1);
      expect(view.tab("b").parentElement?.getAttribute("data-pinned")).toBe("true");
      view.openMenu("c");
      await view.choose("关闭左侧标签");
      expect(view.state().documents.map((doc) => doc.id)).toEqual(["b", "c", "d"]);
      view.openMenu("c");
      await view.choose("关闭右侧标签");
      expect(view.state().documents.map((doc) => doc.id)).toEqual(["b", "c"]);
      view.openMenu("c");
      await view.choose("关闭所有标签");
      expect(view.state().documents.map((doc) => doc.id)).toEqual(["b"]);
      view.openMenu("b");
      await view.choose("关闭固定标签");
      expect(view.state().documents).toEqual([]);
      expect(view.host.querySelector(".document-workspace-toolbar")).toBeNull();
    } finally { view.dispose(); }
  });

  it("批量关闭等待保存，失败整批保留；排序与固定不触发保存或重新挂载文档", async () => {
    const view = fixture();
    try {
      await view.open("a", "b", "c");
      let saves = 0;
      let finish!: (saved: boolean) => void;
      view.state().beforeLeaveRef.current = () => { saves += 1; return new Promise<boolean>((resolve) => { finish = resolve; }); };
      flushSync(() => { void view.state().reorder("a", "c", "after"); void view.state().pin("b", true); });
      expect(saves).toBe(0);
      expect(view.mounts()).toBe(1);
      flushSync(() => { void view.state().closeMany(["a", "b", "c"]); });
      expect(saves).toBe(1);
      expect(view.state().documents).toHaveLength(3);
      finish(false);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(view.state().documents).toHaveLength(3);
      flushSync(() => { void view.state().closeMany(["a", "b", "c"]); });
      finish(true);
      await expect.poll(() => view.state().documents.map((doc) => doc.id)).toEqual(["b"]);
      expect(view.state().activeId).toBe("b");
    } finally { view.dispose(); }
  });

  it("拖动只显示插入线，取消保留顺序，放下才排序且不改变当前文档", async () => {
    const view = fixture();
    view.host.style.width = "800px";
    try {
      await view.open("a", "b", "c");
      const source = view.tab("a").parentElement!;
      const target = view.tab("c").parentElement!;
      const transfer = new DataTransfer();
      const bounds = target.getBoundingClientRect();
      const start = () => source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
      const over = () => target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: bounds.right - 2, clientY: bounds.top + 8 }));
      const renders = view.renders();
      flushSync(() => { start(); over(); });
      expect(view.state().documents.map((doc) => doc.id)).toEqual(["a", "b", "c"]);
      expect(view.host.querySelector('[data-drop="after"]')).not.toBeNull();
      expect(view.renders()).toBe(renders);
      flushSync(() => source.dispatchEvent(new DragEvent("dragend", { bubbles: true })));
      expect(view.host.querySelector("[data-drop]")).toBeNull();
      flushSync(() => { start(); over(); target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })); });
      expect(view.state().documents.map((doc) => doc.id)).toEqual(["b", "c", "a"]);
      expect(view.state().activeId).toBe("c");
      expect(view.mounts()).toBe(1);
      expect(view.host.querySelector("[data-dragging]")).toBeNull();
    } finally { view.dispose(); }
  });

  it("键盘菜单支持取消固定，固定项不被 Delete 或中键误关，聊天菜单没有关闭自身入口", async () => {
    const view = fixture();
    try {
      await view.open("a", "b");
      flushSync(() => { void view.state().pin("b", true); });
      flushSync(() => view.tab("b").dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
      flushSync(() => view.tab("b").parentElement!.dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true })));
      expect(view.state().documents).toHaveLength(2);
      flushSync(() => view.tab("b").dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true })));
      await view.choose("取消固定");
      expect(view.state().pinnedIds).toEqual([]);
      view.openMenu("聊天");
      const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((element) => element.textContent);
      expect(items).not.toContain("关闭");
      expect(items).not.toContain("固定");
      expect(items).not.toContain("取消固定");
      await view.choose("关闭所有标签");
      expect(view.state().documents).toHaveLength(0);
      expect(view.host.querySelector(".document-workspace-toolbar")).toBeNull();
      await expect.poll(() => document.activeElement === view.host.querySelector(".document-workspace-chat")).toBe(true);
    } finally { view.dispose(); }
  });

  it("等待批量保存时重新选择当前标签会取消旧关闭请求，不重复保存", async () => {
    const view = fixture();
    try {
      await view.open("a", "b");
      let saves = 0;
      let finish!: (saved: boolean) => void;
      view.state().beforeLeaveRef.current = () => { saves += 1; return new Promise<boolean>((resolve) => { finish = resolve; }); };
      flushSync(() => { void view.state().closeMany(["a", "b"]); });
      flushSync(() => { void view.state().select("b"); });
      expect(saves).toBe(1);
      finish(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(view.state().documents.map((doc) => doc.id)).toEqual(["a", "b"]);
      expect(view.state().activeId).toBe("b");
    } finally { view.dispose(); }
  });
});
