import { ResizableHandle } from "./resizable-handle.js";

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
  return (
    <ResizableHandle
      className={`workbench-panel-resizer workbench-panel-resizer--${panel}`}
      label={label}
      orientation="horizontal"
      direction={direction}
      value={width}
      minimum={minimumWidth}
      maximum={maximumWidth}
      step={8}
      onResize={onResize}
      onResizeEnd={onResizeEnd}
      onResizeStart={onResizeStart}
    />
  );
}
