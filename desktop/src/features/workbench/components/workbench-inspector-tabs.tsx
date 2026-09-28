import {
  Braces,
  FileCode2,
  FileDiff,
  Files,
  FolderTree,
  GitCommitHorizontal,
  History,
  PanelRightClose,
  X,
} from "lucide-react";
import { Tabs } from "radix-ui";
import { useEffect, useRef } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { documentTabId, type InspectorDocument } from "./workbench-inspector-documents.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";

export type WorkbenchInspectorTab =
  "project" | "changes" | "context" | "history" | `document:${string}`;

const tabIcons = {
  project: FolderTree,
  changes: GitCommitHorizontal,
  context: Braces,
  history: History,
} as const;

export function WorkbenchInspectorTabs({
  activeTab,
  availableTabs,
  documents = [],
  onCloseDocument,
  onTabChange,
}: Readonly<{
  activeTab: WorkbenchInspectorTab;
  availableTabs: readonly WorkbenchInspectorTab[];
  documents?: readonly InspectorDocument[];
  onCloseDocument?: (id: string) => void;
  onTabChange: (tab: WorkbenchInspectorTab) => void;
}>) {
  const activeTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 将当前标签置于视口中间，让左右相邻标签即使原先完全隐藏也能露出一部分。
    activeTriggerRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeTab]);
  const documentsByTab = new Map<string, InspectorDocument>(
    documents.map((document) => [documentTabId(document.id), document]),
  );
  return (
    <Tabs.List asChild aria-label={i18n.t("inspector.title", { ns: "conversation" })}>
      <div className="workbench-inspector-tab-list flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
        {availableTabs.map((value) => {
          const document = documentsByTab.get(value);
          const Icon =
            document?.kind === "diff"
              ? FileDiff
              : document?.kind === "review"
                ? Files
                : document?.kind === "commit"
                  ? GitCommitHorizontal
                  : document !== undefined
                    ? FileCode2
                    : tabIcons[value as keyof typeof tabIcons];
          const isClosableDocument = document !== undefined && onCloseDocument !== undefined;
          const label =
            document === undefined
              ? i18n.t(`inspector.${value}`, { ns: "conversation" })
              : document.kind === "review"
                ? i18n.t("diff.reviewTitle", { ns: "workbench" })
                : document.kind === "commit"
                  ? document.commit.title
                  : document.kind === "diff"
                    ? `Diff: ${document.change.path.split(/[\\/]/u).at(-1) ?? document.change.path}`
                    : document.reference.path.split(/[\\/]/u).at(-1);
          return (
            <div
              {...(isClosableDocument
                ? {
                    "aria-label": i18n.t("inspector.file", { ns: "conversation" }),
                    role: "group",
                  }
                : {})}
              className="relative flex shrink-0 items-center"
              key={value}
            >
              <Tabs.Trigger asChild value={value}>
                <Button
                  className={`rounded-control ${isClosableDocument ? "pr-6" : ""} ${
                    activeTab === value ? "bg-control-hover text-foreground" : ""
                  }`}
                  onClick={() => {
                    onTabChange(value);
                  }}
                  ref={activeTab === value ? activeTriggerRef : undefined}
                  title={
                    document === undefined
                      ? undefined
                      : document.kind === "review" || document.kind === "commit"
                        ? label
                        : document.kind === "diff"
                          ? document.change.path
                          : document.reference.path
                  }
                  size="toolbar"
                  type="button"
                  variant="ghost"
                >
                  <Icon aria-hidden="true" />
                  <span className="max-w-36 truncate">{label}</span>
                </Button>
              </Tabs.Trigger>
              {isClosableDocument ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={i18n.t("inspector.closeFile", { ns: "conversation" })}
                      className="absolute right-1 size-4"
                      onClick={() => {
                        onCloseDocument(document.id);
                      }}
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
    </Tabs.List>
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
  documents,
  onCloseDocument,
  onClose,
  onTabChange,
}: Readonly<{
  activeTab: WorkbenchInspectorTab;
  availableTabs: readonly WorkbenchInspectorTab[];
  documents?: readonly InspectorDocument[];
  onCloseDocument?: (id: string) => void;
  onClose: (() => void) | undefined;
  onTabChange: (tab: WorkbenchInspectorTab) => void;
}>) {
  return (
    <div className="flex h-workbench-header w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden px-1.5">
      <WorkbenchInspectorTabs
        activeTab={activeTab}
        availableTabs={availableTabs}
        {...(documents === undefined ? {} : { documents })}
        {...(onCloseDocument === undefined ? {} : { onCloseDocument })}
        onTabChange={onTabChange}
      />
      <div className="shrink-0 min-[1101px]:hidden">
        <InspectorCloseButton onClose={onClose} />
      </div>
    </div>
  );
}
