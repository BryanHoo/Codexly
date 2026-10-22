import { useEffect, useRef, useState, type RefObject } from "react";

export function DocumentWorkspaceResizer({
  direction,
  containerRef,
  label,
}: Readonly<{
  direction: "right" | "down";
  containerRef: RefObject<HTMLDivElement | null>;
  label: string;
}>) {
  const [ratio, setRatio] = useState(() =>
    Number.parseFloat(
      containerRef.current?.style.getPropertyValue("--document-split-ratio").replace(/^$/u, "50") ??
        "50",
    ),
  );
  const drag = useRef<{ start: number; size: number; ratio: number } | null>(null);
  const value = useRef(ratio);
  const horizontal = direction === "right";
  useEffect(() => {
    const container = containerRef.current;
    const cancel = () => {
      if (drag.current === null) return;
      value.current = drag.current.ratio;
      container?.style.setProperty("--document-split-ratio", `${String(value.current)}%`);
      drag.current = null;
      setRatio(value.current);
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, [containerRef, direction]);
  const update = (next: number) => {
    value.current = Math.min(75, Math.max(25, next));
    // 拖动时直接写布局变量，不逐帧唤醒聊天、编辑器或整个工作台。
    containerRef.current?.style.setProperty("--document-split-ratio", `${String(value.current)}%`);
  };
  return (
    <div
      className="document-workspace-resizer"
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={25}
      aria-valuemax={75}
      aria-valuenow={Math.round(ratio)}
      tabIndex={0}
      onDoubleClick={() => {
        update(50);
        setRatio(50);
      }}
      onKeyDown={(event) => {
        const change = (horizontal ? event.key === "ArrowRight" : event.key === "ArrowDown")
          ? 5
          : (horizontal ? event.key === "ArrowLeft" : event.key === "ArrowUp")
            ? -5
            : 0;
        if (change === 0 && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        event.stopPropagation();
        update(event.key === "Home" ? 25 : event.key === "End" ? 75 : value.current + change);
        setRatio(value.current);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        drag.current = {
          start: horizontal ? rect.left : rect.top,
          size: horizontal ? rect.width : rect.height,
          ratio: value.current,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current === null || drag.current.size === 0) return;
        update(
          (((horizontal ? event.clientX : event.clientY) - drag.current.start) /
            drag.current.size) *
            100,
        );
      }}
      onPointerUp={(event) => {
        if (drag.current === null) return;
        drag.current = null;
        setRatio(value.current);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onLostPointerCapture={() => {
        if (drag.current !== null) update(drag.current.ratio);
        drag.current = null;
        setRatio(value.current);
      }}
    />
  );
}
