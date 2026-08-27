import type { ProjectFileSearchEntry, ProjectOpenApp, ProjectOpenAppId } from "@codexly/protocol";
import { AtSign, ChevronDown, Copy, ExternalLink, FolderOpen } from "lucide-react";
import type { ReactElement } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../shared/components/core/context-menu.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { Button } from "../../../shared/components/core/button.js";
import { ButtonGroup } from "../../../shared/components/core/button-group.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { ProjectFileMutationContextMenuItems } from "./project-file-mutation-menu-items.js";
import {
  copyProjectTargetText,
  getProjectOpenAppsForTarget,
  getProjectTargetName,
  projectOpenAppKindIcons,
  type ProjectOpenContextMenuTarget,
} from "./project-open-menu-model.js";

export {
  ProjectOpenDropdownMenu,
  ProjectOpenDropdownMenuItems,
} from "./project-open-dropdown-menu.js";
export {
  getProjectFileManagerApp,
  getProjectOpenAppsForTarget,
  getProjectTargetAbsolutePath,
  type ProjectOpenContextMenuTarget,
} from "./project-open-menu-model.js";

type ProjectQuickOpenMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  className?: string;
  defaultOpenAppId?: ProjectOpenAppId | null;
  hidden?: boolean;
  isDetecting: boolean;
  isPending: boolean;
  onSelect: (appId: ProjectOpenAppId) => void;
}>;

export function ProjectQuickOpenMenu({
  apps,
  className = "",
  defaultOpenAppId,
  hidden = false,
  isDetecting,
  isPending,
  onSelect,
}: ProjectQuickOpenMenuProps) {
  const { t } = useTranslation("workbench");
  // 临时任务没有 Project 根目录，不渲染目录快捷打开入口。
  if (hidden) {
    return null;
  }
  const directoryApps = getProjectOpenAppsForTarget(apps, "directory");
  // 全局默认值不可用时回退到首个宿主应用，确保快捷入口仍可直接执行。
  const selectedApp = directoryApps.find((app) => app.id === defaultOpenAppId) ?? directoryApps[0];
  const openButtonLabel = isDetecting
    ? t("openMenu.detect")
    : selectedApp === undefined
      ? t("openMenu.none")
      : t("openMenu.openIn", { app: selectedApp.name });
  const compactOpenButtonLabel = selectedApp?.name ?? openButtonLabel;
  const SelectedIcon =
    selectedApp === undefined ? FolderOpen : projectOpenAppKindIcons[selectedApp.kind];

  return (
    <DropdownMenu modal={false}>
      <ButtonGroup className={`shrink-0 ${className}`}>
        <Button
          aria-label={openButtonLabel}
          className="max-w-28 rounded-r-none border-r-0 max-workbench:min-w-11 max-workbench:px-0"
          disabled={selectedApp === undefined || isPending}
          onClick={() => {
            if (selectedApp !== undefined) {
              onSelect(selectedApp.id);
            }
          }}
          size="toolbar"
          title={openButtonLabel}
          type="button"
          variant="outline"
        >
          <SelectedIcon aria-hidden="true" />
          <span className="hidden truncate sm:inline">{compactOpenButtonLabel}</span>
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={t("openMenu.choose")}
            className="rounded-l-none"
            disabled={directoryApps.length === 0 || isPending}
            size="icon-toolbar"
            type="button"
            variant="outline"
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
      </ButtonGroup>
      <DropdownMenuContent align="end" aria-label={t("openMenu.choose")} className="w-52">
        {directoryApps.map((app) => {
          const Icon = projectOpenAppKindIcons[app.kind];
          return (
            <DropdownMenuItem
              aria-label={app.name}
              disabled={isPending}
              key={app.id}
              onSelect={() => {
                onSelect(app.id);
              }}
            >
              <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{app.name}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ProjectOpenContextMenuItemsProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  ariaLabel?: string;
  isPending: boolean;
  onDelete?: () => void;
  onOpenInNewWindow?: () => void;
  onReference: (reference: ProjectFileSearchEntry) => void;
  onRename?: () => void;
  onSelect: (appId: ProjectOpenAppId, path: string) => void;
  target: ProjectOpenContextMenuTarget;
}>;

export function ProjectOpenContextMenuItems({
  apps,
  ariaLabel,
  isPending,
  onDelete,
  onOpenInNewWindow,
  onReference,
  onRename,
  onSelect,
  target,
}: ProjectOpenContextMenuItemsProps) {
  const { t } = useTranslation("workbench");
  const targetApps = getProjectOpenAppsForTarget(apps, target.type);
  const targetName = getProjectTargetName(target.path);
  const reference = target.reference;
  return (
    <ContextMenuContent aria-label={ariaLabel} className="w-52">
      <ContextMenuItem
        onSelect={() => {
          copyProjectTargetText(targetName);
        }}
      >
        <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t("openMenu.copyName")}</span>
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          copyProjectTargetText(target.relativePath);
        }}
      >
        <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t("openMenu.copyRelativePath")}</span>
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => {
          copyProjectTargetText(target.absolutePath);
        }}
      >
        <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
        <span>{t("openMenu.copyAbsolutePath")}</span>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderOpen aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.open")}</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {targetApps.map((app) => {
            const Icon = projectOpenAppKindIcons[app.kind];
            const appName = app.kind === "system-default" ? t("openMenu.systemDefault") : app.name;
            return (
              <ContextMenuItem
                aria-label={appName}
                disabled={isPending}
                key={app.id}
                onSelect={() => {
                  onSelect(app.id, target.path);
                }}
              >
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{appName}</span>
              </ContextMenuItem>
            );
          })}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {target.type === "file" && onOpenInNewWindow !== undefined ? (
        <ContextMenuItem onSelect={onOpenInNewWindow}>
          <ExternalLink aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.openInNewWindow")}</span>
        </ContextMenuItem>
      ) : null}
      {reference === undefined ? null : (
        <ContextMenuItem
          onSelect={() => {
            onReference(reference);
          }}
        >
          <AtSign aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.reference")}</span>
        </ContextMenuItem>
      )}
      {onDelete === undefined || onRename === undefined ? null : (
        <ProjectFileMutationContextMenuItems
          disabled={isPending}
          onDelete={onDelete}
          onRename={onRename}
        />
      )}
    </ContextMenuContent>
  );
}

type ProjectOpenContextMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  children: ReactElement;
  isPending: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  onOpenInNewWindow?: () => void;
  onReference: (reference: ProjectFileSearchEntry) => void;
  onRename?: () => void;
  onSelect: (appId: ProjectOpenAppId, path: string) => void;
  target: ProjectOpenContextMenuTarget;
}>;

export function ProjectOpenContextMenu({
  apps,
  children,
  isPending,
  onOpen,
  onDelete,
  onOpenInNewWindow,
  onReference,
  onRename,
  onSelect,
  target,
}: ProjectOpenContextMenuProps) {
  const { t } = useTranslation("workbench");
  return (
    <ContextMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <ContextMenuTrigger
        asChild
        // 文件树节点递归嵌套，阻止右键事件继续触发父目录菜单。
        onContextMenu={(event) => {
          event.stopPropagation();
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ProjectOpenContextMenuItems
        apps={apps}
        ariaLabel={t("openMenu.targetLabel", { path: target.path })}
        isPending={isPending}
        onReference={onReference}
        {...(onOpenInNewWindow === undefined ? {} : { onOpenInNewWindow })}
        onSelect={onSelect}
        target={target}
        {...(onDelete === undefined || onRename === undefined ? {} : { onDelete, onRename })}
      />
    </ContextMenu>
  );
}
