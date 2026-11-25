import { Braces, Folder, GitBranch, History, PanelRight, type LucideIcon } from "lucide-react";
import { useContext, type RefObject } from "react";
import { Button } from "./button.js";
import { useSplitInspector } from "./split-inspector.js";
import { SplitPaneContext } from "./split-workspace.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

export const workbenchInspectorTabIcons = {
  project: Folder,
  changes: GitBranch,
  context: Braces,
  history: History,
} as const;

type InspectorSection = keyof typeof workbenchInspectorTabIcons;

function isInspectorSection(value: string): value is InspectorSection {
  return Object.hasOwn(workbenchInspectorTabIcons, value);
}

export function WorkbenchInspectorCollapse({
  label,
  onClose,
}: Readonly<{
  label: string;
  onClose: () => void;
}>) {
  const multiple = useContext(SplitPaneContext)?.multiple ?? false;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-expanded="true"
          aria-label={label}
          data-workbench-inspector-collapse=""
          id={multiple ? undefined : "workbench-inspector-toggle"}
          onClick={onClose}
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

export function WorkbenchInspectorRail({
  label,
  expandLabel,
  tabs,
  getTabLabel,
  onSelectTab,
  onOpen,
  shellRef,
}: Readonly<{
  label: string;
  expandLabel: string;
  tabs: readonly string[];
  getTabLabel: (tab: InspectorSection) => string;
  onSelectTab: (tab: InspectorSection) => void;
  onOpen: () => void;
  shellRef: RefObject<HTMLDivElement | null>;
}>) {
  const inspector = useSplitInspector();
  const sections = tabs.filter(isInspectorSection);
  const openTab = (tab: InspectorSection | undefined) => {
    // 开关恢复上一次标签，快捷入口先选择标签再展开。
    if (tab !== undefined) onSelectTab(tab);
    onOpen();
    // 展开会卸载这组按钮，焦点随后移入活动面板或可操作的收起按钮。
    const shell = inspector?.target ?? shellRef.current;
    requestAnimationFrame(() => {
      const panel = shell?.querySelector(".workbench-inspector");
      const target =
        panel?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]') ??
        panel?.querySelector<HTMLButtonElement>("[data-workbench-inspector-close]") ??
        shell?.querySelector<HTMLButtonElement>("[data-workbench-inspector-collapse]");
      if (target?.getClientRects().length) target.focus({ preventScroll: true });
      else
        shell
          ?.querySelector<HTMLButtonElement>("[data-workbench-inspector-collapse]")
          ?.focus({ preventScroll: true });
    });
  };
  const renderButton = (buttonLabel: string, Icon: LucideIcon, tab?: InspectorSection) => (
    <Tooltip key={tab ?? "expand"}>
      <TooltipTrigger asChild>
        <Button
          aria-expanded={false}
          aria-label={buttonLabel}
          data-workbench-inspector-expand={tab === undefined ? "" : undefined}
          id={tab === undefined ? "workbench-inspector-toggle" : undefined}
          onClick={() => {
            openTab(tab);
          }}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{buttonLabel}</TooltipContent>
    </Tooltip>
  );
  return (
    <div className="workbench-inspector-rail" role="group" aria-label={label}>
      {renderButton(expandLabel, PanelRight)}
      {sections.map((tab) => renderButton(getTabLabel(tab), workbenchInspectorTabIcons[tab], tab))}
    </div>
  );
}
