import { useState, type RefObject } from "react";
import { ResizableHandle } from "./resizable-handle.js";

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
  return (
    <ResizableHandle
      className="document-workspace-resizer"
      label={label}
      orientation={direction === "right" ? "horizontal" : "vertical"}
      value={ratio}
      minimum={25}
      maximum={75}
      step={5}
      resetValue={50}
      getUnitsPerPixel={() => {
        // 仅在开始拖动时测量一次；按起始比例与位移换算，避免点击命中区边缘时布局跳动。
        const rect = containerRef.current?.getBoundingClientRect();
        const extent = direction === "right" ? rect?.width : rect?.height;
        return extent === undefined || extent <= 0 ? 0 : 100 / extent;
      }}
      onResize={(next) => {
        containerRef.current?.style.setProperty("--document-split-ratio", `${String(next)}%`);
      }}
      onResizeEnd={setRatio}
    />
  );
}
