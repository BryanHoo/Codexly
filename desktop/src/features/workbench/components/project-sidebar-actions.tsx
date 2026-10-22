import { SidebarFooter } from "@codexly/ui/core/sidebar-footer";
import { translateSidebarFooterLabels } from "@codexly/frontend-core/sidebar-footer-labels";
import type { AppInfoResponse, AppUpdateInstallProgress, Project } from "@/protocol/index.js";
import {
  Archive,
  Ellipsis,
  Pencil,
  Plus,
  FolderOpen,
  FolderPlus,
  Trash2,
} from "lucide-react";

import { lazy, Suspense, useState } from "react";

import { LazyMessageResponse } from "../../../shared/components/agent/lazy-message-response.js";
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
const AppUpdateDialog = lazy(() =>
  import("@codexly/ui/core/app-update-dialog").then((module) => ({ default: module.AppUpdateDialog })),
);

export type SidebarSettingsSection = "about" | "appearance";

export function ProjectPickerButton({
  disabled,
  onOpen,
}: Readonly<{ disabled: boolean; onOpen: (mode: "existing" | "create") => void }>) {
  const { t } = useTranslation("workbench");
  return (
    <DropdownMenu>
      <Tooltip>
      <TooltipTrigger asChild>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("sidebar.addProject")}
          disabled={disabled}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden="true" className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      </TooltipTrigger>
      <TooltipContent>{t("sidebar.addProject")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen("existing")}><FolderOpen aria-hidden="true" />{t("newProject.existing")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpen("create")}><FolderPlus aria-hidden="true" />{t("newProject.title")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
            className="project-hover-action grid size-7 place-items-center rounded-control text-muted-foreground opacity-0 transition-[color,background-color,opacity] hover:bg-control-hover hover:text-foreground focus-visible:opacity-100 focus-visible:shadow-focus group-hover/project:opacity-100 data-[state=open]:opacity-100"
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
  isUpdatePending,
  onUpdate,
  onOpen,
  onOpenShortcuts,
  onTaskNavigate,
}: Readonly<{
  onTaskNavigate?: (projectId: string, taskId: string) => void;
  appInfo?: AppInfoResponse;
  isUpdatePending?: boolean;
  onUpdate: (
    version: string,
    onProgress: (progress: AppUpdateInstallProgress) => void,
  ) => Promise<void>;
  onOpen: (section: SidebarSettingsSection) => void;
  onOpenShortcuts: () => void;
}>) {
  const { t, i18n: translationInstance } = useTranslation("workbench");
  const locale = translationInstance.resolvedLanguage ?? "zh-CN";
  const { t: settingsT } = useTranslation("settings");
  // 打开时固定本次展示的版本与日志，安装回执刷新缓存不会中断弹窗。
  const [updateInfo, setUpdateInfo] = useState<AppInfoResponse | null>(null);
  const appVersion = appInfo?.appVersion ?? "…";
  const updateAvailable = appInfo?.updateAvailable === true;
  return (
    <>
      <SidebarFooter
        labels={translateSidebarFooterLabels((key) => t(`sidebarFooter.${key}`, { version: appVersion }))}
        locale={locale}
        version={appVersion}
        updateAvailable={updateAvailable}
        onSettings={() => { onOpen("appearance"); }}
        onAbout={() => { onOpen("about"); }}
        onUpdate={() => { if (appInfo?.latestVersion) setUpdateInfo(appInfo); }}
        {...(onTaskNavigate === undefined ? {} : { onTaskNavigate })}
        onShortcuts={onOpenShortcuts}
      />
      {updateInfo?.latestVersion ? (
        <Suspense fallback={null}>
          <AppUpdateDialog
            modal={false}
            {...(isUpdatePending === undefined ? {} : { isPending: isUpdatePending })}
            labels={{
              title: settingsT("about.releaseNotesTitle", { version: updateInfo.latestVersion }),
              close: settingsT("actions.closeReleaseNotes"),
              update: settingsT("about.updateNow"),
              updating: settingsT("about.updating"),
              completed: settingsT("about.updated"),
              failed: settingsT("errors.update"),
              progress: settingsT("about.updateProgress"),
            }}
            onClose={() => {
              setUpdateInfo(null);
            }}
            onUpdate={async (reportProgress) => {
              const version = updateInfo.latestVersion;
              if (version === null) return;
              await onUpdate(version, (progress) => {
                // 原生接口以字节上报；未知总量时保留不定进度，避免显示错误百分比。
                reportProgress(
                  progress.totalBytes !== null && progress.totalBytes > 0
                    ? Math.min(100, Math.round(progress.downloadedBytes / progress.totalBytes * 100))
                    : null,
                );
              });
            }}
          >
            <LazyMessageResponse className="text-body-small" mode="static">
              {updateInfo.releaseNotes}
            </LazyMessageResponse>
          </AppUpdateDialog>
        </Suspense>
      ) : null}
    </>
  );
}
