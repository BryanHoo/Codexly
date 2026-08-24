import type { AgentEventConnectionState } from "@code-agent/client";
import type { AppInfoResponse, Project } from "@code-agent/protocol";
import {
  CircleArrowUp,
  Archive,
  Ellipsis,
  LoaderCircle,
  Pencil,
  Plus,
  Settings,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { getProjectSidebarConnectionStatus } from "./project-sidebar-state.js";

export type SidebarSettingsSection = "about" | "appearance";

export function ProjectPickerButton({
  disabled,
  onOpen,
}: Readonly<{ disabled: boolean; onOpen: () => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={t("sidebar.addProject")}
          disabled={disabled}
          onClick={onOpen}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("sidebar.addProject")}</TooltipContent>
    </Tooltip>
  );
}

type ProjectActionsProps = Readonly<{
  isPending: boolean;
  onOpenArchived: (project: Project) => void;
  onRemove: (project: Project) => void;
  onRename: (project: Project) => void;
  project: Project;
}>;

export function ProjectActions({
  isPending,
  onOpenArchived,
  onRemove,
  onRename,
  project,
}: ProjectActionsProps) {
  const { t } = useTranslation("workbench");

  return (
    <div className="relative shrink-0">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            aria-label={t("sidebar.openProjectActions", { project: project.name })}
            className="grid size-7 place-items-center rounded-control text-muted-foreground opacity-0 transition-[color,background-color,opacity] hover:bg-control-hover hover:text-foreground focus-visible:opacity-100 focus-visible:shadow-focus group-hover/project:opacity-100 data-[state=open]:opacity-100"
            disabled={isPending}
            id={`project-actions-${project.id}`}
            type="button"
          >
            <Ellipsis className="size-3.5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <ProjectActionMenu
          isPending={isPending}
          onOpenArchived={() => {
            onOpenArchived(project);
          }}
          onRemove={() => {
            onRemove(project);
          }}
          onRename={() => {
            onRename(project);
          }}
          project={project}
        />
      </DropdownMenu>
    </div>
  );
}

type ProjectActionMenuProps = Readonly<{
  isPending: boolean;
  onOpenArchived: () => void;
  onRemove: () => void;
  onRename: () => void;
  project: Project;
}>;

const projectActionClassName = "h-8 w-full text-left text-foreground";

export function ProjectActionMenu({
  isPending,
  onOpenArchived,
  onRemove,
  onRename,
  project,
}: ProjectActionMenuProps) {
  const { t } = useTranslation("workbench");
  return (
    <DropdownMenuContent
      align="start"
      aria-label={t("sidebar.projectActions", { project: project.name })}
      aria-labelledby={undefined}
      className="w-32"
    >
      <DropdownMenuItem className={projectActionClassName} disabled={isPending} onSelect={onRename}>
        <Pencil className="size-3.5" aria-hidden="true" />
        {t("sidebar.rename")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={projectActionClassName}
        disabled={isPending}
        onSelect={onOpenArchived}
      >
        <Archive className="size-3.5" aria-hidden="true" />
        {t("sidebar.archived")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className={`${projectActionClassName} text-danger`}
        disabled={isPending}
        onSelect={onRemove}
      >
        <Trash2 className="size-3.5" aria-hidden="true" />
        {t("sidebar.remove")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function SidebarSettingsButton({
  appInfo,
  connectionState,
  onOpen,
}: Readonly<{
  appInfo?: AppInfoResponse;
  connectionState: AgentEventConnectionState;
  onOpen: (section: SidebarSettingsSection) => void;
}>) {
  const { t } = useTranslation("workbench");
  const connectionStatus = getProjectSidebarConnectionStatus(connectionState);
  const connectionStatusLabel = t(connectionStatus.labelKey);
  const appVersion = appInfo?.appVersion ?? "…";
  const updateAvailable = appInfo?.updateAvailable === true;
  return (
    <div className="flex h-9 w-full items-stretch text-body-small text-muted-foreground">
      <Button
        aria-label={t("sidebar.settings")}
        className="h-full min-w-0 flex-1 gap-2.5 rounded-r-none px-2.5"
        contentAlign="start"
        id="global-settings-trigger"
        onClick={() => {
          onOpen("appearance");
        }}
        type="button"
        variant="ghost"
      >
        <Settings className="size-4" aria-hidden="true" />
        {t("sidebar.settings")}
      </Button>
      <Button
        aria-label={t("sidebar.aboutStatus", {
          status: connectionStatusLabel,
          update: updateAvailable ? t("sidebar.updateAvailableLabel") : "",
          version: appVersion,
        })}
        className="h-full gap-1 rounded-l-none px-2.5 text-caption"
        id="global-settings-about-trigger"
        onClick={() => {
          onOpen("about");
        }}
        type="button"
        variant="ghost"
      >
        <span aria-live="polite" className="inline-flex items-center gap-1">
          <span className={updateAvailable ? "text-warning" : "text-muted-foreground"}>
            {updateAvailable ? (
              <CircleArrowUp aria-hidden="true" className="mr-1 inline size-3" />
            ) : null}
            v{appVersion}
          </span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className={`inline-flex items-center gap-1 ${connectionStatus.toneClassName}`}>
            <ProjectSidebarConnectionIcon connectionState={connectionState} />
            {connectionStatusLabel}
          </span>
        </span>
      </Button>
    </div>
  );
}

export function ProjectSidebarConnectionIcon({
  connectionState,
}: Readonly<{ connectionState: AgentEventConnectionState }>) {
  if (connectionState === "connected") {
    return <Wifi className="size-3" aria-hidden="true" />;
  }
  if (connectionState === "closed") {
    return <WifiOff className="size-3" aria-hidden="true" />;
  }
  return (
    <span className="inline-flex animate-spin" aria-hidden="true">
      <LoaderCircle className="size-3" />
    </span>
  );
}
