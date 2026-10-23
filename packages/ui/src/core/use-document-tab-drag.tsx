import { useEffect, useRef, type DragEvent, type RefObject } from "react";
import type { WorkspaceDocument } from "@codexly/frontend-core/document-workspace";

type Drop = Readonly<{ targetId: string; placement: "before" | "after" }>;
export function useDocumentTabDrag(
  ref: RefObject<HTMLDivElement | null>,
  documents: readonly WorkspaceDocument[],
  pinnedIds: readonly string[],
  reorder: (id: string, targetId: string, placement: "before" | "after") => unknown,
) {
  const drag = useRef<{
    id: string;
    source: HTMLElement;
    marker: HTMLElement | null;
    drop: Drop | null;
    x: number;
    y: number;
    frame: number | null;
    time: number;
  } | null>(null);
  const clear = () => {
    const current = drag.current;
    if (current === null) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    current.source.removeAttribute("data-dragging");
    current.marker?.removeAttribute("data-drop");
    drag.current = null;
  };
  useEffect(() => clear, [documents]);
  const locate = () => {
    const current = drag.current;
    const list = ref.current;
    if (current === null || list === null) return;
    current.marker?.removeAttribute("data-drop");
    current.drop = null;
    current.marker = null;
    const bounds = list.getBoundingClientRect();
    if (
      current.y < bounds.top ||
      current.y > bounds.bottom ||
      current.x < bounds.left ||
      current.x > bounds.right
    )
      return;
    const target = document
      .elementFromPoint(current.x, current.y)
      ?.closest<HTMLElement>("[data-document-tab-id]");
    if (target === undefined || target === null || !list.contains(target)) return;
    const targetId = target.dataset["documentTabId"];
    const targetIndex = documents.findIndex((item) => item.id === targetId);
    const from = documents.findIndex((item) => item.id === current.id);
    if (from === -1 || targetIndex === -1 || targetId === current.id) return;
    const targetBounds = target.getBoundingClientRect();
    const after = current.x > targetBounds.left + targetBounds.width / 2;
    const remaining = documents.filter((item) => item.id !== current.id);
    const desired = targetIndex - (from < targetIndex ? 1 : 0) + (after ? 1 : 0);
    const pinned = pinnedIds.includes(current.id);
    const index = Math.max(
      pinned ? 0 : pinnedIds.length,
      Math.min(pinned ? pinnedIds.length - 1 : remaining.length, desired),
    );
    if (index === from) return;
    const destination = remaining[index] ?? remaining.at(-1);
    if (destination === undefined) return;
    const placement = index === remaining.length ? "after" : "before";
    const marker = [...list.querySelectorAll<HTMLElement>("[data-document-tab-id]")].find(
      (item) => item.dataset["documentTabId"] === destination.id,
    );
    if (marker === undefined) return;
    marker.dataset["drop"] = placement;
    current.marker = marker;
    current.drop = { targetId: destination.id, placement };
  };
  const tick = (time: number) => {
    const current = drag.current;
    const list = ref.current;
    if (current === null || list === null) return;
    current.frame = null;
    const bounds = list.getBoundingClientRect();
    const chatWidth = list.querySelector<HTMLElement>('[data-chat="true"]')?.offsetWidth ?? 0;
    const left = bounds.left + chatWidth;
    const inside =
      current.y >= bounds.top &&
      current.y <= bounds.bottom &&
      current.x >= bounds.left &&
      current.x <= bounds.right;
    const velocity = !inside
      ? 0
      : current.x < left + 28
        ? -1
        : current.x > bounds.right - 28
          ? 1
          : 0;
    if (velocity === 0) return;
    // 只有靠近边缘时启动帧循环，中心拖动和空闲状态没有后台动画任务。
    const previous = list.scrollLeft;
    list.scrollLeft += velocity * Math.min(32, time - current.time) * 0.5;
    if (list.scrollLeft === previous) return;
    locate();
    current.time = time;
    current.frame = requestAnimationFrame(tick);
  };
  return {
    start: (id: string, event: DragEvent<HTMLElement>) => {
      clear();
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-codexly-document-tab", id);
      event.currentTarget.dataset["dragging"] = "true";
      drag.current = {
        id,
        source: event.currentTarget,
        marker: null,
        drop: null,
        x: event.clientX,
        y: event.clientY,
        frame: null,
        time: performance.now(),
      };
    },
    over: (event: DragEvent<HTMLDivElement>) => {
      if (drag.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      drag.current.x = event.clientX;
      drag.current.y = event.clientY;
      locate();
      if (drag.current.frame === null) {
        drag.current.time = performance.now();
        drag.current.frame = requestAnimationFrame(tick);
      }
    },
    leave: (event: DragEvent<HTMLDivElement>) => {
      if (
        drag.current === null ||
        (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      )
        return;
      // 离开标签条立即撤销目标与滚动，不能在文件内容区误提交上一个插入位置。
      drag.current.x = Number.NEGATIVE_INFINITY;
      drag.current.y = Number.NEGATIVE_INFINITY;
      locate();
    },
    drop: (event: DragEvent<HTMLDivElement>) => {
      const current = drag.current;
      if (current === null) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = current.drop;
      clear();
      if (destination !== null) reorder(current.id, destination.targetId, destination.placement);
    },
    clear,
  };
}
