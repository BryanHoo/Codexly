import type { ProjectFileSearchEntry, ProjectOpenApp, ProjectOpenAppId } from "@codexly/protocol";
import { AtSign, Copy, Ellipsis, ExternalLink, FolderOpen } from "lucide-react";

import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../shared/components/core/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { ProjectFileMutationDropdownMenuItems } from "./project-file-mutation-menu-items.js";
import {
  copyProjectTargetText,
  getProjectOpenAppsForTarget,
  getProjectTargetName,
  projectOpenAppKindIcons,
  type ProjectOpenContextMenuTarget,
} from "./project-open-menu-model.js";

type ProjectOpenDropdownMenuProps = Readonly<{
  apps: readonly ProjectOpenApp[];
  isPending: boolean;
  onOpen: () => void;
  onDelete?: () => void;
  onOpenInNewWindow?: () => void;
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
  onOpenInNewWindow,
  onReference,
  onRename,
  onSelect,
  target,
}: ProjectOpenDropdownMenuProps) {
  const { t } = useTranslation("workbench");
  const targetLabel = t("openMenu.targetLabel", { path: target.path });

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) onOpen();
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
      <ProjectOpenDropdownMenuItems
        apps={apps}
        isPending={isPending}
        onReference={onReference}
        onSelect={onSelect}
        target={target}
        {...(onDelete === undefined || onRename === undefined ? {} : { onDelete, onRename })}
        {...(onOpenInNewWindow === undefined ? {} : { onOpenInNewWindow })}
      />
    </DropdownMenu>
  );
}

type ProjectOpenDropdownMenuItemsProps = Omit<ProjectOpenDropdownMenuProps, "onOpen">;

export function ProjectOpenDropdownMenuItems({
  apps,
  isPending,
  onDelete,
  onOpenInNewWindow,
  onReference,
  onRename,
  onSelect,
  target,
}: ProjectOpenDropdownMenuItemsProps) {
  const { t } = useTranslation("workbench");
  // 行尾入口复用右键菜单的目标过滤，目录不会暴露仅文件可用的系统默认应用。
  const targetApps = getProjectOpenAppsForTarget(apps, target.type);
  const targetLabel = t("openMenu.targetLabel", { path: target.path });
  const targetName = getProjectTargetName(target.path);
  const reference = target.reference;

  return (
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
            const Icon = projectOpenAppKindIcons[app.kind];
            const appName = app.kind === "system-default" ? t("openMenu.systemDefault") : app.name;
            return (
              <DropdownMenuItem
                aria-label={appName}
                disabled={isPending}
                key={app.id}
                onSelect={() => {
                  onSelect(app.id, target.path);
                }}
              >
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{appName}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {target.type === "file" && onOpenInNewWindow !== undefined ? (
        <DropdownMenuItem onSelect={onOpenInNewWindow}>
          <ExternalLink aria-hidden="true" className="size-4 text-muted-foreground" />
          <span>{t("openMenu.openInNewWindow")}</span>
        </DropdownMenuItem>
      ) : null}
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
  );
}
