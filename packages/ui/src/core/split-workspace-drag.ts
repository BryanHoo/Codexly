import { useCallback, useLayoutEffect, useRef, type DOMAttributes, type RefObject } from "react";
import type { SplitLayout } from "@codexly/frontend-core/split-layout";

type Target = Readonly<{ element: HTMLElement; key: string; rect: DOMRect }>;
interface DragSession {
  container: HTMLDivElement;
  handle: HTMLButtonElement;
  source: Target;
  targets: readonly Target[];
  pointerId: number | undefined;
  pointerType: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  active: boolean;
  target: Target | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  frame: number | undefined;
  preview: HTMLDivElement | undefined;
  previewLabel: HTMLSpanElement | undefined;
  dispose: () => void;
}

const findTarget = (session: DragSession, x: number, y: number) =>
  session.targets.find(
    ({ rect }) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom,
  );

function activate(session: DragSession) {
  session.active = true;
  session.container.dataset["reordering"] = session.pointerId === undefined ? "select" : "drag";
  session.source.element.dataset["splitDragSource"] = "";
  session.handle.setAttribute("aria-pressed", "true");
  if (session.pointerId !== undefined) {
    // 只创建轻量图标和状态标签，不复制窗口正文；反馈挂到 body，移出原分栏后仍能看见。
    const preview = document.createElement("div");
    preview.className = "split-workspace-drag-preview";
    preview.setAttribute("aria-hidden", "true");
    const icon = session.handle.querySelector("svg");
    if (icon !== null) preview.append(icon.cloneNode(true));
    const label = document.createElement("span");
    label.textContent = session.handle.dataset["splitDraggingLabel"] ?? "";
    preview.append(label);
    session.preview = preview;
    session.previewLabel = label;
    positionPreview(session);
    document.body.append(preview);
  }
}

function positionPreview(session: DragSession) {
  if (session.preview === undefined) return;
  // 仅按帧写 transform；用固定反馈尺寸钳制视口边缘，移动时不读取 DOM 布局。
  const x = Math.max(8, Math.min(session.x + 16, window.innerWidth - 200));
  const y = Math.max(8, Math.min(session.y + 16, window.innerHeight - 48));
  session.preview.style.transform = `translate3d(${String(x)}px, ${String(y)}px, 0)`;
}

function dragHandle(target: EventTarget | null): HTMLButtonElement | null {
  return target instanceof Element ? target.closest("button[data-split-drag-handle]") : null;
}

/** 工作区只保留一个手势会话；高频坐标存在 ref 中，不触发聊天组件和任务订阅更新。 */
export function useSplitWorkspaceDrag(
  containerRef: RefObject<HTMLDivElement | null>,
  layout: SplitLayout | undefined,
  swap: (source: string, target: string) => void,
): DOMAttributes<HTMLDivElement> {
  const sessionRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const finish = useCallback(
    (target?: Target) => {
      const session = sessionRef.current;
      if (session === null) return;
      // 先清空会话，再释放捕获；lostpointercapture 不得重复提交或干扰下一次手势。
      sessionRef.current = null;
      clearTimeout(session.timer);
      if (session.frame !== undefined) cancelAnimationFrame(session.frame);
      session.dispose();
      session.preview?.remove();
      delete session.container.dataset["reordering"];
      delete session.source.element.dataset["splitDragSource"];
      delete session.target?.element.dataset["splitDropTarget"];
      session.handle.setAttribute("aria-pressed", "false");
      if (session.pointerId !== undefined && session.handle.hasPointerCapture(session.pointerId)) {
        session.handle.releasePointerCapture(session.pointerId);
      }
      if (target !== undefined && target.key !== session.source.key)
        swap(session.source.key, target.key);
    },
    [swap],
  );

  useLayoutEffect(
    () => () => {
      // 布局变化、恢复单窗或卸载时撤销旧坐标，不允许迟到事件交换新的工作区。
      finish();
    },
    [layout, finish],
  );

  const begin = (
    handle: HTMLButtonElement,
    pointerId?: number,
    x = 0,
    y = 0,
    pointerType = "mouse",
  ) => {
    const container = containerRef.current;
    if (layout === undefined || container === null || container.hasAttribute("data-resizing"))
      return;
    const sourceElement = handle.closest<HTMLElement>("[data-split-pane]");
    // 一次性读取最多四个窗口的矩形；滚动和尺寸改变会取消会话，移动时无需读取布局。
    const targets = [...container.querySelectorAll<HTMLElement>(":scope > [data-split-pane]")].map(
      (element) => ({
        element,
        key: element.dataset["splitPane"] ?? "",
        rect: element.getBoundingClientRect(),
      }),
    );
    const source = targets.find(({ element }) => element === sourceElement);
    if (source === undefined || targets.length < 2) return;
    const containerRect = container.getBoundingClientRect();
    const cancel = () => {
      finish();
    };
    // 侧栏开合等容器变化不一定触发 window.resize，同样必须使缓存坐标失效。
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width !== containerRect.width || rect.height !== containerRect.height) finish();
    });
    observer.observe(container);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      finish();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) finish();
    };
    const visibility = () => {
      if (document.hidden) finish();
    };
    // 全局监听仅在按压或选择期间存在，空闲工作区不增加监听与持续帧循环。
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("visibilitychange", visibility);
    const session: DragSession = {
      container,
      handle,
      source,
      targets,
      pointerId,
      pointerType,
      x,
      y,
      startX: x,
      startY: y,
      active: false,
      target: undefined,
      timer: undefined,
      frame: undefined,
      preview: undefined,
      previewLabel: undefined,
      dispose: () => {
        observer.disconnect();
        window.removeEventListener("blur", cancel);
        window.removeEventListener("resize", cancel);
        window.removeEventListener("scroll", cancel, true);
        window.removeEventListener("keydown", escape, true);
        document.removeEventListener("pointerdown", outside, true);
        document.removeEventListener("visibilitychange", visibility);
      },
    };
    sessionRef.current = session;
    if (pointerId === undefined) activate(session);
    else {
      handle.setPointerCapture(pointerId);
      session.timer = setTimeout(() => {
        activate(session);
        suppressClickRef.current = true;
      }, 300);
    }
  };

  return {
    onPointerDown: (event) => {
      if (sessionRef.current !== null || event.button !== 0 || !event.isPrimary) return;
      // 只吞掉同一次拖动合成的 click；新的按压（包括正文控件）不受上次取消影响。
      suppressClickRef.current = false;
      const handle = dragHandle(event.target);
      if (handle === null) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      begin(handle, event.pointerId, event.clientX, event.clientY, event.pointerType);
    },
    onPointerMove: (event) => {
      const session = sessionRef.current;
      if (
        session === null ||
        (session.pointerId !== undefined && session.pointerId !== event.pointerId)
      )
        return;
      session.x = event.clientX;
      session.y = event.clientY;
      if (!session.active) {
        if (Math.hypot(session.x - session.startX, session.y - session.startY) <= 8) return;
        suppressClickRef.current = true;
        // macOS 三指拖移复用鼠标指针流；允许按下后直接移动，不能要求先静止 300ms。
        // 触屏及手写笔仍保留长按，避免滑动过程误触交换。
        if (session.pointerType !== "mouse") {
          finish();
          return;
        }
        clearTimeout(session.timer);
        activate(session);
      }
      if (session.frame !== undefined) return;
      session.frame = requestAnimationFrame(() => {
        session.frame = undefined;
        const hit = findTarget(session, session.x, session.y);
        const target = hit === session.source ? undefined : hit;
        positionPreview(session);
        if (session.target === target) return;
        if (session.previewLabel !== undefined) {
          session.previewLabel.textContent =
            session.handle.dataset[
              target === undefined ? "splitDraggingLabel" : "splitDropLabel"
            ] ?? "";
        }
        // 每帧最多改变两个高亮标记，命中同一窗口时不重复写高亮，也不移动聊天正文。
        delete session.target?.element.dataset["splitDropTarget"];
        session.target = target;
        if (target !== undefined) target.element.dataset["splitDropTarget"] = "";
      });
    },
    onPointerUp: (event) => {
      const session = sessionRef.current;
      if (session?.pointerId !== event.pointerId) return;
      // 使用松手坐标同步命中，不能依赖尚未绘制的最后一帧。
      finish(session.active ? findTarget(session, event.clientX, event.clientY) : undefined);
    },
    onPointerCancel: (event) => {
      if (sessionRef.current?.pointerId === event.pointerId) finish();
    },
    onLostPointerCapture: (event) => {
      if (sessionRef.current?.pointerId === event.pointerId) finish();
    },
    onClickCapture: (event) => {
      if (suppressClickRef.current && event.detail !== 0) {
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const handle = dragHandle(event.target);
      const session = sessionRef.current;
      if (session !== null && session.pointerId === undefined) {
        event.preventDefault();
        event.stopPropagation();
        // 点击、触控轻点及键盘激活共用同一交换动作，提供无需持续按压的替代操作。
        const target =
          handle === null
            ? findTarget(session, event.clientX, event.clientY)
            : session.targets.find(({ element }) => element.contains(handle));
        finish(target);
      } else if (session === null && handle !== null) {
        event.preventDefault();
        event.stopPropagation();
        begin(handle);
      }
    },
    onContextMenu: (event) => {
      if (sessionRef.current !== null || dragHandle(event.target) !== null) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onDragStartCapture: (event) => {
      if (dragHandle(event.target) !== null) event.preventDefault();
    },
  };
}
