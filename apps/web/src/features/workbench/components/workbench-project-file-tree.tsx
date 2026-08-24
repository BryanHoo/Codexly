import type { ProjectFileSearchEntry, ProjectOpenApp, ProjectOpenAppId } from "@codexly/protocol";
import {
  asyncDataLoaderFeature,
  buildProxiedInstance,
  hotkeysCoreFeature,
  type ItemInstance,
  propMemoizationFeature,
  type SetStateFn,
  selectionFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, File, Folder, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type RefCallback,
} from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { FileTreeActions } from "../../../shared/components/agent/file-tree.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodexlyFileTreeClient } from "../../projects/project-query-contracts.js";
import {
  createProjectFileTreeDataLoader,
  PROJECT_FILE_TREE_PROJECT_ROOT_ID,
  PROJECT_FILE_TREE_ROOT_ID,
  type ProjectFileTreeItem,
} from "./project-file-tree-model.js";
import {
  collectVisibleProjectFileTreeChangeStats,
  ProjectFileTreeChangeIndicator,
  pruneCollapsedProjectFileTreePaths,
} from "./project-file-tree-changes.js";
import { ProjectFileTreeRootActions } from "./workbench-inspector-file-tree.js";
import { ProjectOpenContextMenu, ProjectOpenDropdownMenu } from "./project-open-menu.js";
import { createProjectFileTreeOpenTarget } from "./project-file-tree-open-target.js";

export const PROJECT_FILE_TREE_ROW_HEIGHT_PX = 28;
const PROJECT_FILE_TREE_INDENT_PX = 16;
const PROJECT_FILE_TREE_OVERSCAN = 8;
const PROJECT_FILE_TREE_INITIAL_RECT = { height: 600, width: 320 };
type WorkbenchProjectFileTreeProps = Readonly<{
  client: CodexlyFileTreeClient;
  expandedPaths: ReadonlySet<string>;
  fileChangesByPath: ReadonlyMap<string, AgentFileChange>;
  onExpandedPathsChange: (paths: Set<string>) => void;
  onOpenFileDiff: (change: AgentFileChange) => void;
  onOpenProjectFile: (path: string) => void;
  onOpenProjectPath: (appId: ProjectOpenAppId, path?: string) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshProject: () => unknown;
  projectId: string;
  projectName: string;
  projectRootId: string;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
  projectRefreshing?: boolean;
}>;

type TreeItemProps = HTMLAttributes<HTMLDivElement> & Readonly<{ ref?: RefCallback<HTMLElement> }>;
function resolveState<T>(value: T | ((old: T) => T), current: T): T {
  return typeof value === "function" ? (value as (old: T) => T)(current) : value;
}

function getItemName(item: ProjectFileTreeItem): string {
  if (item.kind !== "status") return item.name;
  if (item.status === "empty") return i18n.t("inspector.emptyFolder", { ns: "conversation" });
  return i18n.t("inspector.readFolderError", { name: item.name, ns: "conversation" });
}

type ProjectFileTreeRowProps = Readonly<{
  changeStatsByPath: ReturnType<typeof collectVisibleProjectFileTreeChangeStats>;
  item: ItemInstance<ProjectFileTreeItem>;
  onOpenProjectPath: (appId: ProjectOpenAppId, path?: string) => void;
  onReferenceProjectPath: (entry: ProjectFileSearchEntry) => void;
  onRefreshDirectory: (path: string | null) => void;
  onRefreshProject: () => unknown;
  onSelect: (id: string) => void;
  projectOpenApps: readonly ProjectOpenApp[];
  projectOpenPending: boolean;
  projectPath: string;
  projectRootId: string;
  projectRefreshing: boolean;
}>;

const ProjectFileTreeRow = memo(function ProjectFileTreeRow({
  changeStatsByPath,
  item,
  onOpenProjectPath,
  onReferenceProjectPath,
  onRefreshDirectory,
  onRefreshProject,
  onSelect,
  projectOpenApps,
  projectOpenPending,
  projectPath,
  projectRootId,
  projectRefreshing,
}: ProjectFileTreeRowProps) {
  const data = item.getItemData();
  const name = getItemName(data);
  const target = createProjectFileTreeOpenTarget(data, { id: projectRootId, path: projectPath });
  const openTarget =
    data.kind === "root"
      ? (appId: ProjectOpenAppId) => {
          onOpenProjectPath(appId);
        }
      : onOpenProjectPath;
  const { ref: itemRef, ...itemProps } = item.getProps() as TreeItemProps;
  const level = item.getItemMeta().level;
  const isFolder = item.isFolder();
  const isExpanded = item.isExpanded();
  const isLoading = item.isLoading();
  const refreshName = data.kind === "status" ? data.name : name;
  const changeStats = data.kind === "entry" ? changeStatsByPath.get(data.path) : undefined;

  if (data.kind === "status") {
    return (
      <div
        {...itemProps}
        className={`flex h-7 items-center gap-2 pr-1.5 text-caption ${data.status === "error" ? "text-diff-removed" : "text-muted-foreground"}`}
        ref={itemRef}
        style={{ paddingLeft: level * PROJECT_FILE_TREE_INDENT_PX + 6 }}
      >
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {data.status === "error" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={i18n.t("inspector.refreshFolder", {
                  name: refreshName,
                  ns: "conversation",
                })}
                onClick={(event) => {
                  event.stopPropagation();
                  onRefreshDirectory(data.directoryPath);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {i18n.t("inspector.refreshFolder", {
                name: refreshName,
                ns: "conversation",
              })}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    );
  }

  const row = (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Headless Tree 通过 itemProps 注入完整 treeitem 键盘与 ARIA 属性。
    <div
      {...itemProps}
      className={`group/file-tree-node flex h-7 w-full items-center gap-1 rounded-control pr-1.5 text-left transition-colors hover:bg-control-hover focus-visible:shadow-focus focus-visible:outline-none ${item.isSelected() ? "bg-control" : ""}`}
      onContextMenu={(event) => {
        itemProps.onContextMenu?.(event);
        onSelect(item.getId());
      }}
      onKeyDown={(event) => {
        itemProps.onKeyDown?.(event);
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          item.primaryAction();
          if (isFolder) {
            if (isExpanded) item.collapse();
            else item.expand();
          }
        }
      }}
      ref={itemRef}
      style={{ paddingLeft: level * PROJECT_FILE_TREE_INDENT_PX + 2 }}
    >
      {isFolder ? (
        <Button
          aria-label={i18n.t(
            isExpanded ? "agentComponents.folderCollapse" : "agentComponents.folderExpand",
            { name, ns: "conversation" },
          )}
          className="inline-grid size-5 shrink-0 place-items-center rounded-control text-muted-foreground hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
          onClick={(event) => {
            event.stopPropagation();
            if (isExpanded) item.collapse();
            else item.expand();
          }}
          size="embedded"
          type="button"
          variant="embedded"
        >
          {isLoading ? (
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            />
          )}
        </Button>
      ) : (
        <span aria-hidden="true" className="size-5 shrink-0" />
      )}
      {isFolder ? (
        isExpanded ? (
          <FolderOpen aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
        ) : (
          <Folder aria-hidden="true" className="size-3.5 shrink-0 text-brand" />
        )
      ) : (
        <File aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate" title={data.kind === "entry" ? data.path : name}>
        {name}
      </span>
      {data.kind === "entry" && changeStats !== undefined ? (
        <ProjectFileTreeChangeIndicator path={data.path} stats={changeStats} />
      ) : null}
      {data.kind === "root" ? (
        <ProjectFileTreeRootActions
          onMenuOpen={() => {
            onSelect(item.getId());
          }}
          onOpenProjectPath={onOpenProjectPath}
          onReferenceProjectPath={onReferenceProjectPath}
          onRefreshProject={onRefreshProject}
          projectName={name}
          projectOpenApps={projectOpenApps}
          projectOpenPending={projectOpenPending}
          projectPath={projectPath}
          refreshing={projectRefreshing}
        />
      ) : target === null ? null : (
        <FileTreeActions>
          <ProjectOpenDropdownMenu
            apps={projectOpenApps}
            isPending={projectOpenPending}
            onOpen={() => {
              onSelect(item.getId());
            }}
            onReference={onReferenceProjectPath}
            onSelect={onOpenProjectPath}
            target={target}
          />
        </FileTreeActions>
      )}
    </div>
  );

  return target === null ? (
    row
  ) : (
    <ProjectOpenContextMenu
      apps={projectOpenApps}
      isPending={projectOpenPending}
      onOpen={() => {
        onSelect(item.getId());
      }}
      onReference={onReferenceProjectPath}
      onSelect={openTarget}
      target={target}
    >
      {row}
    </ProjectOpenContextMenu>
  );
});

export function WorkbenchProjectFileTree({
  client,
  expandedPaths,
  fileChangesByPath,
  onExpandedPathsChange,
  onOpenFileDiff,
  onOpenProjectFile,
  onOpenProjectPath,
  onReferenceProjectPath,
  onRefreshProject,
  projectId,
  projectName,
  projectOpenApps,
  projectOpenPending,
  projectPath,
  projectRootId,
  projectRefreshing = false,
}: WorkbenchProjectFileTreeProps) {
  useTranslation("conversation");
  const queryClient = useQueryClient();
  const scrollElementRef = useRef<HTMLDivElement>(null);
  const scrollToItemRef = useRef<(itemId: string) => void>(() => undefined);
  const [rootExpanded, setRootExpanded] = useState(true);
  const [selectedItems, setSelectedItemsState] = useState<string[]>([]);
  const dataLoader = useMemo(
    () =>
      createProjectFileTreeDataLoader({
        client,
        projectId,
        projectName,
        queryClient,
        rootPath: projectPath,
      }),
    [client, projectId, projectName, projectPath, queryClient],
  );
  const expandedItems = useMemo(
    () => [...(rootExpanded ? [PROJECT_FILE_TREE_PROJECT_ROOT_ID] : []), ...expandedPaths],
    [expandedPaths, rootExpanded],
  );
  const setExpandedItems = useCallback<SetStateFn<string[]>>(
    (value) => {
      const nextItems = resolveState(value, expandedItems);
      setRootExpanded(nextItems.includes(PROJECT_FILE_TREE_PROJECT_ROOT_ID));
      const nextPaths = new Set(nextItems.filter((id) => id !== PROJECT_FILE_TREE_PROJECT_ROOT_ID));
      onExpandedPathsChange(pruneCollapsedProjectFileTreePaths(expandedPaths, nextPaths));
    },
    [expandedItems, expandedPaths, onExpandedPathsChange],
  );
  const setSelectedItems = useCallback<SetStateFn<string[]>>(
    (value) => {
      const nextItems = resolveState(value, selectedItems);
      const selectedItem = nextItems.at(-1) ?? selectedItems.at(-1);
      setSelectedItemsState(selectedItem === undefined ? [] : [selectedItem]);
    },
    [selectedItems],
  );
  const tree = useTree<ProjectFileTreeItem>({
    createLoadingItemData: () => ({ kind: "root", name: projectName, type: "directory" }),
    dataLoader,
    features: [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      propMemoizationFeature,
    ],
    getItemName: (item) => getItemName(item.getItemData()),
    indent: PROJECT_FILE_TREE_INDENT_PX,
    instanceBuilder: buildProxiedInstance,
    isItemFolder: (item) => item.getItemData().type === "directory",
    onPrimaryAction: (item) => {
      const data = item.getItemData();
      if (data.kind !== "entry" || data.type !== "file") return;
      const change = fileChangesByPath.get(data.path);
      if (change === undefined) onOpenProjectFile(data.path);
      else onOpenFileDiff(change);
    },
    rootItemId: PROJECT_FILE_TREE_ROOT_ID,
    scrollToItem: (item) => {
      scrollToItemRef.current(item.getId());
    },
    setExpandedItems,
    setSelectedItems,
    state: { expandedItems, selectedItems },
  });
  const items = tree.getItems();
  const changeStatsByPath = useMemo(
    () =>
      fileChangesByPath.size === 0
        ? new Map()
        : collectVisibleProjectFileTreeChangeStats(
            fileChangesByPath,
            items.map((item) => item.getItemData()),
          ),
    [fileChangesByPath, items],
  );
  const itemIndexById = useMemo(
    () => new Map(items.map((item, index) => [item.getId(), index])),
    [items],
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    estimateSize: () => PROJECT_FILE_TREE_ROW_HEIGHT_PX,
    getItemKey: (index) => items[index]?.getKey() ?? index,
    getScrollElement: () => scrollElementRef.current,
    initialRect: PROJECT_FILE_TREE_INITIAL_RECT,
    overscan: PROJECT_FILE_TREE_OVERSCAN,
  });
  scrollToItemRef.current = (itemId) => {
    const index = itemIndexById.get(itemId);
    if (index !== undefined) virtualizer.scrollToIndex(index, { align: "auto" });
  };
  const refreshDirectory = useCallback(
    async (directoryPath: string | null, optimistic = false) => {
      await queryClient.invalidateQueries({
        exact: true,
        queryKey: ["projects", projectId, projectPath, "file-tree", directoryPath],
        refetchType: "none",
      });
      const itemId = directoryPath ?? PROJECT_FILE_TREE_PROJECT_ROOT_ID;
      await tree.getItemInstance(itemId).invalidateChildrenIds(optimistic);
    },
    [projectId, projectPath, queryClient, tree],
  );
  const refreshProject = useCallback(
    () =>
      Promise.all([
        Promise.resolve(onRefreshProject()),
        refreshDirectory(null, true),
        ...[...expandedPaths].map((path) => refreshDirectory(path, true)),
      ]),
    [expandedPaths, onRefreshProject, refreshDirectory],
  );
  const { ref: containerRef, ...containerProps } = tree.getContainerProps(
    i18n.t("inspector.fileTree", { ns: "conversation" }),
  ) as HTMLAttributes<HTMLDivElement> & Readonly<{ ref?: RefCallback<HTMLElement> }>;

  return (
    <div
      {...containerProps}
      className="h-full w-full cursor-default overflow-y-auto font-mono text-label text-foreground"
      data-project-file-tree=""
      ref={(node) => {
        scrollElementRef.current = node;
        containerRef?.(node);
      }}
    >
      {items.length === 0 ? (
        <div
          aria-expanded={rootExpanded}
          aria-label={i18n.t("inspector.projectFilesLoading", { ns: "conversation" })}
          aria-selected="false"
          className="flex h-7 items-center gap-1.5 px-1.5 text-muted-foreground"
          role="treeitem"
        >
          <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          <span className="min-w-0 flex-1 truncate">{projectName}</span>
        </div>
      ) : null}
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return (
            <div
              className="absolute left-0 top-0 w-full"
              data-index={virtualItem.index}
              key={virtualItem.key}
              style={{
                height: PROJECT_FILE_TREE_ROW_HEIGHT_PX,
                transform: `translateY(${String(virtualItem.start)}px)`,
              }}
            >
              <ProjectFileTreeRow
                changeStatsByPath={changeStatsByPath}
                item={item}
                onOpenProjectPath={onOpenProjectPath}
                onReferenceProjectPath={onReferenceProjectPath}
                onRefreshDirectory={(path) => {
                  void refreshDirectory(path);
                }}
                onRefreshProject={refreshProject}
                onSelect={(id) => {
                  setSelectedItemsState([id]);
                }}
                projectOpenApps={projectOpenApps}
                projectOpenPending={projectOpenPending}
                projectPath={projectPath}
                projectRootId={projectRootId}
                projectRefreshing={projectRefreshing}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
