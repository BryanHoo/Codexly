import type { RefObject } from "react";

import { Button } from "../../../shared/components/core/button.js";
import { WorkbenchPanelResizer } from "./workbench-panel-resizer.js";
import { sidebarWidthLimits } from "./workbench-panel-layout.js";

export function WorkbenchSidebarChrome({
  closeLabel,
  onClose,
  onWidthChange,
  open,
  resizeLabel,
  shellRef,
  width,
}: Readonly<{
  closeLabel: string;
  onClose: () => void;
  onWidthChange: (width: number) => void;
  open: boolean;
  resizeLabel: string;
  shellRef: RefObject<HTMLDivElement | null>;
  width: number;
}>) {
  if (!open) return null;
  return (
    <>
      <Button
        aria-label={closeLabel}
        className="workbench-sidebar-scrim"
        onClick={onClose}
        type="button"
        variant="ghost"
      />
      <WorkbenchPanelResizer
        direction={1}
        label={resizeLabel}
        maximumWidth={sidebarWidthLimits.maximum}
        minimumWidth={sidebarWidthLimits.minimum}
        onResize={(nextWidth) => {
          shellRef.current?.style.setProperty("--sidebar-open-width", `${String(nextWidth)}px`);
        }}
        onResizeEnd={(nextWidth) => {
          shellRef.current?.removeAttribute("data-resizing-panel");
          onWidthChange(nextWidth);
        }}
        onResizeStart={() => {
          shellRef.current?.setAttribute("data-resizing-panel", "sidebar");
        }}
        panel="sidebar"
        width={width}
      />
    </>
  );
}
