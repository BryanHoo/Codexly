import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import type { SplitDirection } from "@codexly/frontend-core/split-layout";
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel } from "./context-menu.js";

const actions = [
  { direction: "up", icon: ArrowUp, key: "↑" },
  { direction: "down", icon: ArrowDown, key: "↓" },
  { direction: "left", icon: ArrowLeft, key: "←" },
  { direction: "right", icon: ArrowRight, key: "→" },
] as const;

export default function SplitWorkspaceMenuContent({
  labels,
  limit,
  onSplit,
}: Readonly<{
  labels: Record<SplitDirection, string> & { limit: string };
  limit: boolean;
  onSplit: (direction: SplitDirection) => void;
}>) {
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  return (
    <ContextMenuContent
      onCloseAutoFocus={(event) => {
        event.preventDefault();
      }}
    >
      {limit ? <ContextMenuLabel>{labels.limit}</ContextMenuLabel> : null}
      {actions.map(({ direction, icon: Icon, key }) => (
        <ContextMenuItem
          key={direction}
          disabled={limit}
          onSelect={() => {
            onSplit(direction);
          }}
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {labels[direction]}
          <span aria-hidden="true" className="ml-auto pl-4 text-caption text-muted-foreground">
            {mac ? "⌘ ⌥" : "Ctrl Alt"} {key}
          </span>
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  );
}
