import {
  Braces,
  FileCode2,
  FolderTree,
  GitCommitHorizontal,
  History,
  PanelRightClose,
  X,
} from "lucide-react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export type WorkbenchInspectorTab = "project" | "changes" | "context" | "history" | "file";

const tabIcons = {
  project: FolderTree,
  changes: GitCommitHorizontal,
  context: Braces,
  file: FileCode2,
  history: History,
} as const;

export function WorkbenchInspectorTabs({
  activeTab,
  availableTabs,
  onCloseFile,
  onTabChange,
}: Readonly<{
  activeTab: WorkbenchInspectorTab;
  availableTabs: readonly WorkbenchInspectorTab[];
  onCloseFile?: () => void;
  onTabChange: (tab: WorkbenchInspectorTab) => void;
}>) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist">
      {availableTabs.map((value) => {
        const Icon = tabIcons[value];
        const isClosableFileTab = value === "file" && onCloseFile !== undefined;
        return (
          <div
            {...(isClosableFileTab
              ? {
                  "aria-label": i18n.t("inspector.file", { ns: "conversation" }),
                  role: "group",
                }
              : {})}
            className="relative flex shrink-0 items-center"
            key={value}
          >
            <Button
              aria-selected={activeTab === value}
              className={`rounded-control ${isClosableFileTab ? "pr-6" : ""} ${
                activeTab === value ? "bg-control-hover text-foreground" : ""
              }`}
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
            {isClosableFileTab ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={i18n.t("inspector.closeFile", { ns: "conversation" })}
                    className="absolute right-1 size-4"
                    onClick={onCloseFile}
                    size="embedded"
                    type="button"
                    variant="ghost"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {i18n.t("inspector.closeFile", { ns: "conversation" })}
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>
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
  onCloseFile,
  onTabChange,
}: Readonly<{
  activeTab: WorkbenchInspectorTab;
  availableTabs: readonly WorkbenchInspectorTab[];
  contextOnly: boolean;
  onClose: (() => void) | undefined;
  onCloseFile?: () => void;
  onTabChange: (tab: WorkbenchInspectorTab) => void;
}>) {
  if (contextOnly && availableTabs.length === 1) {
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
        {...(onCloseFile === undefined ? {} : { onCloseFile })}
        onTabChange={onTabChange}
      />
      <div className="shrink-0 min-[1101px]:hidden">
        <InspectorCloseButton onClose={onClose} />
      </div>
    </div>
  );
}
