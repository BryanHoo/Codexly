import { useEffect, useLayoutEffect, useMemo, type RefObject } from "react";

interface Position {
  path: number[];
  tag: string;
  className: string;
  top: number;
  left: number;
}

/** 仅保存滚动容器的坐标与结构路径，不保留后台文档 DOM、正文或持续渲染任务。 */
export function useDocumentScroll(
  ref: RefObject<HTMLDivElement | null>,
  id: string | undefined,
  documents: readonly { id: string }[],
  scope: object,
) {
  const cache = useMemo(() => new Map<string, Map<string, Position>>(), [scope]);
  useLayoutEffect(() => {
    const retained = new Set(documents.map((document) => document.id));
    for (const key of cache.keys()) if (!retained.has(key)) cache.delete(key);
  }, [cache, documents]);
  // 在子预览完成初始行号定位后恢复，避免源码组件的挂载 effect 覆盖阅读位置。
  useEffect(() => {
    const root = ref.current;
    if (!root || id === undefined) return;
    const positions = cache.get(id) ?? new Map<string, Position>();
    cache.set(id, positions);
    const pending = new Map(positions);
    const locate = (path: readonly number[]) => {
      let target: Element | undefined = root;
      for (const index of path) target = target?.children[index];
      return target instanceof HTMLElement ? target : undefined;
    };
    const capture = (event: Event) => {
      const target = event.target;
      // CodeMirror 已由编辑会话保存精确阅读锚点，不能用像素坐标覆盖其虚拟布局恢复。
      if (!(target instanceof HTMLElement) || target.closest(".cm-editor")) return;
      const path: number[] = [];
      let node: Element = target;
      while (node !== root) {
        const parent: Element | null = node.parentElement;
        if (!parent) return;
        path.unshift(Array.prototype.indexOf.call(parent.children, node));
        node = parent;
      }
      const key = path.join("/");
      // 加载占位或尺寸不足时产生的归零事件不得覆盖尚未恢复的阅读位置。
      if (pending.has(key)) return;
      positions.set(key, {
        path,
        tag: target.tagName,
        className: target.className,
        top: target.scrollTop,
        left: target.scrollLeft,
      });
    };
    const stop = () => {
      mutations.disconnect();
      resize.disconnect();
      root.removeEventListener("load", restore, true);
    };
    const restore = () => {
      for (const [key, position] of pending) {
        const target = locate(position.path);
        if (!target || target.tagName !== position.tag || target.className !== position.className)
          continue;
        // 只观察需要恢复的容器及内容；异步 Markdown、高亮和图片加载后再尝试，不轮询整份文件。
        resize.observe(target);
        if (target.firstElementChild) resize.observe(target.firstElementChild);
        target.scrollTop = position.top;
        target.scrollLeft = position.left;
        if (
          Math.abs(target.scrollTop - position.top) < 1 &&
          Math.abs(target.scrollLeft - position.left) < 1
        )
          pending.delete(key);
      }
      if (!pending.size) stop();
    };
    const mutations = new MutationObserver(restore);
    const resize = new ResizeObserver(restore);
    const cancel = () => {
      // 用户主动滚动或操作后以新阅读意图为准，不让迟到的内容加载把视图拉回旧位置。
      pending.clear();
      stop();
    };
    root.addEventListener("scroll", capture, { capture: true, passive: true });
    const intents = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of intents)
      root.addEventListener(event, cancel, { capture: true, passive: true });
    if (pending.size) {
      mutations.observe(root, { childList: true, subtree: true });
      root.addEventListener("load", restore, true);
      restore();
    }
    return () => {
      stop();
      root.removeEventListener("scroll", capture, true);
      for (const event of intents) root.removeEventListener(event, cancel, true);
    };
  }, [cache, id, ref]);
}
