import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { EditorView, Panel } from "@codemirror/view";
import { getSearchQuery } from "@codemirror/search";
import { TextEditorSearchPanel } from "./text-editor-search-panel.js";

/** CodeMirror 管理查询与生命周期，React 只渲染打开的面板，不复制或扫描正文。 */
export function createTextEditorSearchPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-file-search";
  dom.setAttribute("role", "search");
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  let root: Root | undefined;
  let resize: ResizeObserver | undefined;
  let query = getSearchQuery(view.state);
  return {
    dom,
    top: true,
    mount() {
      // 旧版 macOS WebView 没有容器查询，仅在该环境监听面板尺寸；跨断点才改变属性。
      if (!CSS.supports("container-type", "inline-size")) {
        resize = new ResizeObserver(([entry]) => {
          if (entry) dom.toggleAttribute("data-compact", entry.contentRect.width <= 560);
        });
        resize.observe(dom);
      }
      root = createRoot(dom);
      root.render(createElement(TextEditorSearchPanel, { view, subscribe }));
    },
    update() {
      const next = getSearchQuery(view.state);
      // 光标、正文和高亮更新不唤醒面板；只有官方查询对象变化才通知 React。
      if (next === query) return;
      query = next;
      for (const listener of listeners) listener();
    },
    destroy() {
      resize?.disconnect();
      listeners.clear();
      // 编辑视图可能在父组件布局清理中销毁，延后释放独立根，避免嵌套卸载 React。
      const mounted = root;
      queueMicrotask(() => mounted?.unmount());
    },
  };
}
