import type {
  ProjectFileSearchEntry,
  ProjectOpenApp,
  ProjectOpenAppId,
  ProjectOpenAppKind,
} from "@codexly/protocol";
import {
  AtSign,
  ChevronDown,
  Code2,
  Copy,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  Terminal,
  Wrench,
} from "lucide-react";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import { Button } from "../../../shared/components/core/button.js";
import { ButtonGroup } from "../../../shared/components/core/button-group.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";
import {
  ProjectFileMutationContextMenuItems,
  ProjectFileMutationDropdownMenuItems,
} from "./project-file-mutation-menu-items.js";

const appKindIcons = {
  editor: Code2,
  "file-manager": FolderOpen,
  "system-default": ExternalLink,
  terminal: Terminal,
  tool: Wrench,
} as const satisfies Record<ProjectOpenAppKind, typeof Code2>;

type ProjectOpenTargetType = "directory" | "file";

export function getProjectOpenAppsForTarget(
  apps: readonly ProjectOpenApp[],
  targetType: ProjectOpenTargetType,
): readonly ProjectOpenApp[] {
  return targetType === "file" ? apps : apps.filter((app) => app.kind !== "system-default");
}

export function getProjectFileManagerApp(
  apps: readonly ProjectOpenApp[],
): ProjectOpenApp | undefined {
  return apps.find((app) => app.kind === "file-manager");
}

type ProjectQuickOpenMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  className?: string;
  defaultOpenAppId?: ProjectOpenAppId | null;
  isDetecting: boolean;
  isPending: boolean;
  onSelect: (appId: ProjectOpenAppId) => void;
}>;

export function ProjectQuickOpenMenu({
  apps,
  className = "",
  defaultOpenAppId,
  isDetecting,
  isPending,
  onSelect,
}: ProjectQuickOpenMenuProps) {
  const { t } = useTranslation("workbench");
  const directoryApps = getProjectOpenAppsForTarget(apps, "directory");
  // 全局默认值不可用时回退到首个宿主应用，确保快捷入口仍可直接执行。
  const selectedApp = directoryApps.find((app) => app.id === defaultOpenAppId) ?? directoryApps[0];
  const openButtonLabel = isDetecting
    ? t("openMenu.detect")
    : selectedApp === undefined
      ? t("openMenu.none")
      : t("openMenu.openIn", { app: selectedApp.name });
  const compactOpenButtonLabel = selectedApp?.name ?? openButtonLabel;
  const SelectedIcon = selectedApp === undefined ? FolderOpen : appKindIcons[selectedApp.kind];

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
          const Icon = appKindIcons[app.kind];
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

export type ProjectOpenContextMenuTarget = Readonly<{
  absolutePath: string;
  path: string;
  relativePath: string;
  reference?: ProjectFileSearchEntry;
  type: ProjectOpenTargetType;
}>;

type ProjectOpenContextMenuItemsProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  ariaLabel?: string;
  isPending: boolean;
  onDelete?: () => void;
  onReference: (reference: ProjectFileSearchEntry) => void;
  onRename?: () => void;
  onSelect: (appId: ProjectOpenAppId, path: string) => void;
  target: ProjectOpenContextMenuTarget;
}>;

function getProjectTargetName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

export function getProjectTargetAbsolutePath(projectRootPath: string, targetPath: string): string {
  const usesWindowsSeparator = projectRootPath.includes("\\") && !projectRootPath.includes("/");
  const separator = usesWindowsSeparator ? "\\" : "/";
  const rootPath = projectRootPath.replace(/[\\/]+$/u, "");
  const relativePath = usesWindowsSeparator
    ? targetPath.replace(/\//gu, "\\").replace(/^\\+/u, "")
    : targetPath.replace(/\\/gu, "/").replace(/^\/+/u, "");

  return relativePath === ""
    ? rootPath || projectRootPath
    : `${rootPath}${separator}${relativePath}`;
}

function copyProjectTargetText(text: string) {
  // 菜单关闭不应等待系统剪贴板，失败时保留当前文件树状态。
  void navigator.clipboard.writeText(text).catch(() => undefined);
}

export function ProjectOpenContextMenuItems({
  apps,
  ariaLabel,
  isPending,
  onDelete,
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
            const Icon = appKindIcons[app.kind];
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

type ProjectOpenDropdownMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  isPending: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  onReference: (reference: ProjectFileSearchEntry) => void;
  onRename?: () => void;
  onSelect: (appId: ProjectOpenAppId, path: string) => void;
  target: ProjectOpenContextMenuTarget;
}>;

export function ProjectOpenDropdownMenu({
  apps,
  isPending,
  onOpen,
  onDelete,
  onReference,
  onRename,
  onSelect,
  target,
}: ProjectOpenDropdownMenuProps) {
  const { t } = useTranslation("workbench");
  // 行尾入口复用右键菜单的目标过滤，目录不会暴露仅文件可用的系统默认应用。
  const targetApps = getProjectOpenAppsForTarget(apps, target.type);
  const targetLabel = t("openMenu.targetLabel", { path: target.path });
  const targetName = getProjectTargetName(target.path);
  const reference = target.reference;

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          onOpen();
        }
      }}
    >
      <Tooltip>
        <DropdownMenuTrigger asChild>
          <TooltipTrigger asChild>
            <Button
              aria-label={targetLabel}
              className="pointer-events-none size-5 shrink-0 opacity-0 transition-opacity group-hover/file-tree-node:pointer-events-auto group-hover/file-tree-node:opacity-100 group-focus-within/file-tree-node:pointer-events-auto group-focus-within/file-tree-node:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100"
              size="embedded"
              type="button"
              variant="embedded"
            >
              <Ellipsis aria-hidden="true" className="size-3.5" />
            </Button>
          </TooltipTrigger>
        </DropdownMenuTrigger>
        <TooltipContent side="left">{t("openMenu.moreActions")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" aria-label={targetLabel} className="w-52">
        <DropdownMenuItem
          onSelect={() => {
            copyProjectTargetText(targetName);
          }}
        >
          <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.copyName")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            copyProjectTargetText(target.relativePath);
          }}
        >
          <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.copyRelativePath")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            copyProjectTargetText(target.absolutePath);
          }}
        >
          <Copy aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.copyAbsolutePath")}</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <FolderOpen aria-hidden="true" className="size-4 text-muted-foreground" />
            <span>{t("openMenu.open")}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {targetApps.map((app) => {
              const Icon = appKindIcons[app.kind];
              const appName =
                app.kind === "system-default" ? t("openMenu.systemDefault") : app.name;
              return (
                <DropdownMenuItem
                  aria-label={appName}
                  disabled={isPending}
                  key={app.id}
                  onSelect={() => {
                    onSelect(app.id, target.path);
                  }}
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{appName}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {reference === undefined ? null : (
          <DropdownMenuItem
            onSelect={() => {
              onReference(reference);
            }}
          >
            <AtSign aria-hidden="true" className="size-4 text-muted-foreground" />
            <span>{t("openMenu.reference")}</span>
          </DropdownMenuItem>
        )}
        {onDelete === undefined || onRename === undefined ? null : (
          <ProjectFileMutationDropdownMenuItems
            disabled={isPending}
            onDelete={onDelete}
            onRename={onRename}
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ProjectOpenContextMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  children: ReactElement;
  isPending: boolean;
  onOpen: () => void;
  onDelete?: () => void;
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
        onSelect={onSelect}
        target={target}
        {...(onDelete === undefined || onRename === undefined ? {} : { onDelete, onRename })}
      />
    </ContextMenu>
  );
}
