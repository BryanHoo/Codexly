import { useCallback, useLayoutEffect, useRef, type PointerEvent } from "react";

type ResizableHandleProps = Readonly<{
  className: string;
  label: string;
  orientation: "horizontal" | "vertical";
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  direction?: 1 | -1;
  resetValue?: number;
  getUnitsPerPixel?: () => number;
  onResize: (value: number) => void;
  onResizeEnd: (value: number) => void;
  onResizeStart?: () => void;
}>;

interface ResizeSession {
  handle: HTMLDivElement;
  pointerId: number;
  start: number;
  initial: number;
  current: number;
  previewed: number;
  scale: number;
  frame: number | undefined;
  preview: (value: number) => void;
  end: (value: number) => void;
  cancel: () => void;
}

function preview(session: ResizeSession, value: number) {
  if (session.previewed === value) return;
  session.previewed = value;
  session.handle.setAttribute("aria-valuenow", String(Math.round(value)));
  session.preview(value);
}

/** 借鉴 shadcn Resizable 的分隔条交互，保留宿主布局及预览/提交分离的性能边界。 */
export function ResizableHandle({
  className,
  label,
  orientation,
  value,
  minimum,
  maximum,
  step,
  direction = 1,
  resetValue,
  getUnitsPerPixel,
  onResize,
  onResizeEnd,
  onResizeStart,
}: ResizableHandleProps) {
  const sessionRef = useRef<ResizeSession | null>(null);
  const clamp = (next: number) => Math.min(maximum, Math.max(minimum, next));
  const horizontal = orientation === "horizontal";

  const finish = useCallback((commit: boolean) => {
    const session = sessionRef.current;
    if (session === null) return;
    // 先清空事务并解绑监听，再释放捕获，避免 lostpointercapture 重复结束或迟到帧覆盖恢复值。
    sessionRef.current = null;
    if (session.frame !== undefined) cancelAnimationFrame(session.frame);
    window.removeEventListener("blur", session.cancel);
    window.removeEventListener("resize", session.cancel);
    if (session.handle.hasPointerCapture(session.pointerId)) {
      session.handle.releasePointerCapture(session.pointerId);
    }
    delete session.handle.dataset["resizing"];
    const next = commit ? session.current : session.initial;
    preview(session, next);
    session.end(next);
  }, []);

  useLayoutEffect(
    () => () => {
      // 卸载、切换对照方向或外部尺寸约束改变时取消旧事务，不能沿用旧坐标或遗留遮罩。
      finish(false);
    },
    [finish, orientation, direction, minimum, maximum, value],
  );

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (session?.pointerId !== event.pointerId) return;
    session.current = clamp(
      session.initial +
        ((horizontal ? event.clientX : event.clientY) - session.start) * session.scale,
    );
    if (session.frame !== undefined) return;
    // 一帧只写一次样式和语义值；不把高频位置存入 React，也不重新读取容器布局。
    session.frame = requestAnimationFrame(() => {
      session.frame = undefined;
      preview(session, session.current);
    });
  };

  const apply = (next: number) => {
    const size = clamp(next);
    onResize(size);
    onResizeEnd(size);
  };

  return (
    <div
      className={className}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={Math.round(value)}
      onDoubleClick={
        resetValue === undefined
          ? undefined
          : (event) => {
              event.preventDefault();
              event.stopPropagation();
              finish(false);
              apply(resetValue);
            }
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && sessionRef.current !== null) {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
          return;
        }
        if (sessionRef.current !== null || event.altKey || event.ctrlKey || event.metaKey) return;
        const delta =
          event.key === (horizontal ? "ArrowLeft" : "ArrowUp")
            ? -step
            : event.key === (horizontal ? "ArrowRight" : "ArrowDown")
              ? step
              : 0;
        if (delta === 0 && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        event.stopPropagation();
        // 左右栏沿分隔线视觉方向移动；Home / End 始终表示受控面板的最小 / 最大尺寸。
        apply(
          event.key === "Home"
            ? minimum
            : event.key === "End"
              ? maximum
              : value + delta * direction,
        );
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || sessionRef.current !== null) return;
        const scale = (getUnitsPerPixel?.() ?? 1) * direction;
        if (!Number.isFinite(scale) || scale === 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        const cancel = () => {
          finish(false);
        };
        sessionRef.current = {
          handle: event.currentTarget,
          pointerId: event.pointerId,
          start: horizontal ? event.clientX : event.clientY,
          initial: value,
          current: value,
          previewed: value,
          scale,
          frame: undefined,
          preview: onResize,
          end: onResizeEnd,
          cancel,
        };
        event.currentTarget.dataset["resizing"] = "true";
        // 仅拖动期间监听全局取消事件，空闲分隔条不注册窗口监听器。
        window.addEventListener("blur", cancel);
        window.addEventListener("resize", cancel);
        onResizeStart?.();
      }}
      onPointerMove={move}
      onPointerUp={(event) => {
        if (sessionRef.current?.pointerId !== event.pointerId) return;
        // 松手位置可能尚未产生 pointermove，结束时先采样并同步刷新最终值。
        move(event);
        finish(true);
      }}
      onPointerCancel={(event) => {
        if (sessionRef.current?.pointerId === event.pointerId) finish(false);
      }}
      onLostPointerCapture={(event) => {
        if (sessionRef.current?.pointerId === event.pointerId) finish(false);
      }}
    />
  );
}
