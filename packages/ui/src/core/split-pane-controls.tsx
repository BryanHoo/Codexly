import { useContext } from "react";
import { Maximize2, X } from "lucide-react";
import { Button } from "./button.js";
import { SplitPaneContext, useSplitWorkspace } from "./split-workspace.js";

export function SplitPaneControls({
  closeLabel,
  soloLabel,
}: Readonly<{ closeLabel: string; soloLabel: string }>) {
  const pane = useContext(SplitPaneContext);
  const workspace = useSplitWorkspace();
  if (!pane?.multiple || workspace === null) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={soloLabel}
        title={soloLabel}
        onClick={() => {
          workspace.solo(pane.pane);
        }}
      >
        <Maximize2 aria-hidden="true" className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={closeLabel}
        title={closeLabel}
        onClick={() => {
          workspace.close(pane.pane);
        }}
      >
        <X aria-hidden="true" className="size-3.5" />
      </Button>
    </>
  );
}
