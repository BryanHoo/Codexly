import { Braces, FolderTree, GitCommitHorizontal, History, PanelRightClose } from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export type WorkbenchInspectorTab = "project" | "changes" | "context" | "history";

const tabIcons = {
  project: FolderTree,
  changes: GitCommitHorizontal,
  context: Braces,
  history: History,
} as const;

export function WorkbenchInspectorTabs({
  activeTab,
  availableTabs,
  onTabChange,
}: Readonly<{
  activeTab: WorkbenchInspectorTab;
  availableTabs: readonly WorkbenchInspectorTab[];
  onTabChange: (tab: WorkbenchInspectorTab) => void;
}>) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist">
      {availableTabs.map((value) => {
        const Icon = tabIcons[value];
        return (
          <Button
            aria-selected={activeTab === value}
            className={`rounded-control ${
              activeTab === value ? "bg-control-hover text-foreground" : ""
            }`}
            key={value}
            onClick={() => {
              onTabChange(value);
            }}
            role="tab"
            size="toolbar"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden="true" />
            <span>{i18n.t(`inspector.${value}`, { ns: "conversation" })}</span>
          </Button>
        );
      })}
    </div>
  );
}

function InspectorCloseButton({ onClose }: Readonly<{ onClose: (() => void) | undefined }>) {
  if (onClose === undefined) return null;
  const label = i18n.t("shell.closeInspector", { ns: "workbench" });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} onClick={onClose} size="icon-sm" type="button" variant="ghost">
          <PanelRightClose aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function WorkbenchInspectorHeader({
  activeTab,
  availableTabs,
  contextOnly,
  onClose,
  onTabChange,
}: Readonly<{
  activeTab: WorkbenchInspectorTab;
  availableTabs: readonly WorkbenchInspectorTab[];
  contextOnly: boolean;
  onClose: (() => void) | undefined;
  onTabChange: (tab: WorkbenchInspectorTab) => void;
}>) {
  if (contextOnly) {
    return (
      <div className="absolute right-2 top-2 z-10 min-[1101px]:hidden">
        <InspectorCloseButton onClose={onClose} />
      </div>
    );
  }
  return (
    <div className="flex min-h-workbench-header w-full min-w-0 items-center gap-2 overflow-hidden px-1.5">
      <WorkbenchInspectorTabs
        activeTab={activeTab}
        availableTabs={availableTabs}
        onTabChange={onTabChange}
      />
      <div className="shrink-0 min-[1101px]:hidden">
        <InspectorCloseButton onClose={onClose} />
      </div>
    </div>
  );
}
