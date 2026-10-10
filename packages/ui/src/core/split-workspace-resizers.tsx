import {
  useCallback,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  getSplitLayoutCells,
  getSplitLayoutDividers,
  MIN_SPLIT_RATIO,
  MAX_SPLIT_RATIO,
  resizeSplitLayout,
  type SplitLayout,
  type SplitLayoutCell,
  type SplitLayoutDivider,
} from "@codexly/frontend-core/split-layout";

const percent = (value: number) => `${String(value * 12.5)}%`;

export function splitPaneStyle(cell: SplitLayoutCell): CSSProperties {
  return {
    left: percent(cell.x),
    top: percent(cell.y),
    width: percent(cell.width),
    height: percent(cell.height),
  };
}

function dividerStyle(divider: SplitLayoutDivider): CSSProperties {
  return divider.axis === "horizontal"
    ? {
        left: percent(divider.x + divider.width * divider.ratio),
        top: percent(divider.y),
        height: percent(divider.height),
      }
    : {
        left: percent(divider.x),
        top: percent(divider.y + divider.height * divider.ratio),
        width: percent(divider.width),
      };
}

function previewLayout(container: HTMLDivElement, layout: SplitLayout) {
  const cells = getSplitLayoutCells(layout);
  const dividers = new Map(
    getSplitLayoutDividers(layout).map((divider) => [divider.path, divider]),
  );
  // 同一帧集中写入样式，不在写入之间读取布局；聊天组件和任务订阅不参与拖动渲染。
  for (const pane of container.querySelectorAll<HTMLElement>(":scope > [data-split-pane]")) {
    const cell = cells.get(pane.dataset["splitPane"] ?? "");
    if (cell !== undefined) Object.assign(pane.style, splitPaneStyle(cell));
  }
  for (const handle of container.querySelectorAll<HTMLElement>(":scope > [data-split-divider]")) {
    const divider = dividers.get(handle.dataset["splitDivider"] ?? "");
    if (divider === undefined) continue;
    Object.assign(handle.style, dividerStyle(divider));
    handle.setAttribute("aria-valuenow", String(Math.round(divider.ratio * 100)));
  }
}

interface ResizeSession {
  container: HTMLDivElement;
  handle: HTMLDivElement;
  pointerId: number;
  divider: SplitLayoutDivider;
  start: number;
  extent: number;
  minimum: number;
  ratio: number;
  layout: SplitLayout;
  frame: number | undefined;
}

export function SplitWorkspaceResizers({
  layout,
  containerRef,
  resize,
  widthLabel,
  heightLabel,
}: Readonly<{
  layout: SplitLayout;
  containerRef: RefObject<HTMLDivElement | null>;
  resize: (path: string, ratio: number) => void;
  widthLabel: string;
  heightLabel: string;
}>) {
  const sessionRef = useRef<ResizeSession | null>(null);

  const finish = useCallback(
    (commit: boolean, restore = true) => {
      const session = sessionRef.current;
      if (session === null) return;
      sessionRef.current = null;
      if (session.frame !== undefined) cancelAnimationFrame(session.frame);
      // 先清理捕获与遮罩，避免丢失捕获事件重复提交；取消、失焦或卸载时恢复原布局。
      if (session.handle.hasPointerCapture(session.pointerId)) {
        session.handle.releasePointerCapture(session.pointerId);
      }
      delete session.container.dataset["resizing"];
      if (restore) {
        previewLayout(
          session.container,
          commit
            ? resizeSplitLayout(session.layout, session.divider.path, session.ratio)
            : session.layout,
        );
      }
      if (commit) resize(session.divider.path, session.ratio);
    },
    [resize],
  );

  useLayoutEffect(() => {
    // React 不会重写值未变化的 style 属性，拓扑变化后必须同步清除上一帧的预览尺寸。
    if (containerRef.current !== null) previewLayout(containerRef.current, layout);
    const cancel = () => {
      finish(false);
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      // 卸载或恢复单窗时只清理捕获，不能把已被 React 清除的分屏尺寸重新写回。
      finish(false, false);
    };
    // 布局拓扑变化或卸载立即取消拖动，不能让旧路径修改新工作区。
  }, [layout, finish, containerRef]);

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session?.pointerId !== event.pointerId) return;
    const coordinate = session.divider.axis === "horizontal" ? event.clientX : event.clientY;
    session.ratio = Math.min(
      1 - session.minimum,
      Math.max(
        session.minimum,
        session.divider.ratio + (coordinate - session.start) / session.extent,
      ),
    );
    if (session.frame !== undefined) return;
    // 高频指针事件合并到浏览器帧；松开时同步刷新最后位置，然后仅提交一次 React 状态。
    session.frame = requestAnimationFrame(() => {
      session.frame = undefined;
      previewLayout(
        session.container,
        resizeSplitLayout(session.layout, session.divider.path, session.ratio),
      );
    });
  };

  return getSplitLayoutDividers(layout).map((divider) => (
    <div
      key={divider.path}
      className="split-workspace-resizer"
      data-split-divider={divider.path}
      data-axis={divider.axis}
      style={dividerStyle(divider)}
      role="separator"
      tabIndex={0}
      aria-label={divider.axis === "horizontal" ? widthLabel : heightLabel}
      aria-orientation={divider.axis === "horizontal" ? "vertical" : "horizontal"}
      aria-valuemin={MIN_SPLIT_RATIO * 100}
      aria-valuemax={MAX_SPLIT_RATIO * 100}
      aria-valuenow={Math.round(divider.ratio * 100)}
      onPointerDown={(event) => {
        const container = containerRef.current;
        if (event.button !== 0 || sessionRef.current !== null || container === null) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = container.getBoundingClientRect();
        const horizontal = divider.axis === "horizontal";
        const extent = (horizontal ? rect.width * divider.width : rect.height * divider.height) / 8;
        if (extent <= 0) return;
        // 正常空间下保留可用的窗口尺寸；小容器采用相对下限，避免分割线锁死。
        const minimum = Math.min(
          0.45,
          Math.max(MIN_SPLIT_RATIO, (horizontal ? 140 : 100) / extent),
        );
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        sessionRef.current = {
          container,
          handle: event.currentTarget,
          pointerId: event.pointerId,
          divider,
          start: horizontal ? event.clientX : event.clientY,
          extent,
          minimum,
          ratio: divider.ratio,
          layout,
          frame: undefined,
        };
        container.dataset["resizing"] = divider.axis;
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        if (sessionRef.current?.pointerId !== event.pointerId) return;
        move(event);
        finish(true);
      }}
      onPointerCancel={(event) => {
        if (sessionRef.current?.pointerId === event.pointerId) finish(false);
      }}
      onLostPointerCapture={(event) => {
        if (sessionRef.current?.pointerId === event.pointerId) finish(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && sessionRef.current !== null) {
          event.preventDefault();
          finish(false);
          return;
        }
        const horizontal = divider.axis === "horizontal";
        const delta =
          event.key === (horizontal ? "ArrowLeft" : "ArrowUp")
            ? -0.02
            : event.key === (horizontal ? "ArrowRight" : "ArrowDown")
              ? 0.02
              : 0;
        if (
          delta === 0 ||
          sessionRef.current !== null ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        resize(divider.path, divider.ratio + delta);
      }}
    />
  ));
}
