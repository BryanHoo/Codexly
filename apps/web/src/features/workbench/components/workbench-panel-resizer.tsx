/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- ARIA separator 按规范支持焦点、方向键和指针拖拽。 */
import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

type WorkbenchPanelResizerProps = Readonly<{
  direction: 1 | -1;
  label: string;
  maximumWidth: number;
  minimumWidth: number;
  onResize: (width: number) => void;
  onResizeEnd: (width: number) => void;
  onResizeStart: () => void;
  panel: "sidebar" | "inspector";
  width: number;
}>;

interface PointerResizeSession {
  currentWidth: number;
  pointerId: number;
  startWidth: number;
  startX: number;
}

const keyboardResizeStep = 8;

function clampWidth(width: number, minimumWidth: number, maximumWidth: number) {
  return Math.min(maximumWidth, Math.max(minimumWidth, width));
}

export function WorkbenchPanelResizer({
  direction,
  label,
  maximumWidth,
  minimumWidth,
  onResize,
  onResizeEnd,
  onResizeStart,
  panel,
  width,
}: WorkbenchPanelResizerProps) {
  const pointerSessionRef = useRef<PointerResizeSession | null>(null);

  const finishPointerResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const session = pointerSessionRef.current;
    if (session?.pointerId !== event.pointerId) {
      return;
    }

    pointerSessionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onResizeEnd(session.currentWidth);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }

    event.preventDefault();
    // 方向键按分隔线的视觉移动方向换算为对应面板的宽度变化。
    const visualDelta = event.key === "ArrowLeft" ? -keyboardResizeStep : keyboardResizeStep;
    const nextWidth = clampWidth(width + visualDelta * direction, minimumWidth, maximumWidth);
    onResize(nextWidth);
    onResizeEnd(nextWidth);
  };

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={maximumWidth}
      aria-valuemin={minimumWidth}
      aria-valuenow={width}
      className={`workbench-panel-resizer workbench-panel-resizer--${panel}`}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishPointerResize}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }

        event.preventDefault();
        pointerSessionRef.current = {
          currentWidth: width,
          pointerId: event.pointerId,
          startWidth: width,
          startX: event.clientX,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizeStart();
      }}
      onPointerMove={(event) => {
        const session = pointerSessionRef.current;
        if (session?.pointerId !== event.pointerId) {
          return;
        }

        const nextWidth = session.startWidth + (event.clientX - session.startX) * direction;
        session.currentWidth = clampWidth(nextWidth, minimumWidth, maximumWidth);
        // 高频拖拽直接同步语义值和 CSS 变量，避免整棵工作台随指针频率重渲染。
        event.currentTarget.setAttribute("aria-valuenow", String(session.currentWidth));
        onResize(session.currentWidth);
      }}
      onPointerUp={finishPointerResize}
      role="separator"
      tabIndex={0}
    />
  );
}
