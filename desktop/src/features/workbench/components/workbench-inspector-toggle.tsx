import { SplitPaneContext } from "@codexly/ui/core/split-workspace";
import { useId, useContext } from "react";
import { PanelRight } from "lucide-react";

import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export function WorkbenchInspectorToggle({
  collapseLabel,
  expandLabel,
  inspectorOpen,
  onToggle,
}: Readonly<{
  collapseLabel: string;
  expandLabel: string;
  inspectorOpen: boolean;
  onToggle: () => void;
}>) {
  const id = useId();
  const multiple = useContext(SplitPaneContext)?.multiple ?? false;
  const label = inspectorOpen ? collapseLabel : expandLabel;
  return (
    <Tooltip key={inspectorOpen ? "inspector-open" : "inspector-closed"}>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          id={multiple ? `${id}-inspector-toggle` : "workbench-inspector-toggle"}
          onClick={onToggle}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <PanelRight className="size-3.5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
