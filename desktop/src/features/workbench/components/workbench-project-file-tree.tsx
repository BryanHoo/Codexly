import { ProjectFileTreeRow } from "./project-file-tree-row.js";
import type { ProjectFileTree } from "@codexly/protocol";
import {
  asyncDataLoaderFeature,
  buildProxiedInstance,
  hotkeysCoreFeature,
  propMemoizationFeature,
  type SetStateFn,
  selectionFeature,
} from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LoaderCircle } from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type RefCallback,
} from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import {
  createProjectFileTreeDataLoader,
  getProjectFileTreeItemName,
  PROJECT_FILE_TREE_PROJECT_ROOT_ID,
  PROJECT_FILE_TREE_ROOT_ID,
  resolveProjectFileTreeState,
  type ProjectFileTreeItem,
} from "./project-file-tree-model.js";
import {
  collectVisibleProjectFileTreeChangeStats,
  pruneCollapsedProjectFileTreePaths,
} from "./project-file-tree-changes.js";
import type { WorkbenchProjectFileTreeProps } from "./workbench-project-file-tree-contracts.js";

export const PROJECT_FILE_TREE_ROW_HEIGHT_PX = 28;
const PROJECT_FILE_TREE_INDENT_PX = 16;
const PROJECT_FILE_TREE_OVERSCAN = 8;
const PROJECT_FILE_TREE_INITIAL_RECT = { height: 600, width: 320 };


export function WorkbenchProjectFileTree({
  client,
  expandedPaths,
  fileChangesByPath,
  onExpandedPathsChange,
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
      const nextItems = resolveProjectFileTreeState(value, expandedItems);
      setRootExpanded(nextItems.includes(PROJECT_FILE_TREE_PROJECT_ROOT_ID));
      const nextPaths = new Set(nextItems.filter((id) => id !== PROJECT_FILE_TREE_PROJECT_ROOT_ID));
      onExpandedPathsChange(pruneCollapsedProjectFileTreePaths(expandedPaths, nextPaths));
    },
    [expandedItems, expandedPaths, onExpandedPathsChange],
  );
  const setSelectedItems = useCallback<SetStateFn<string[]>>(
    (value) => {
      const nextItems = resolveProjectFileTreeState(value, selectedItems);
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
    getItemName: (item) => getProjectFileTreeItemName(item.getItemData()),
    indent: PROJECT_FILE_TREE_INDENT_PX,
    instanceBuilder: buildProxiedInstance,
    isItemFolder: (item) => item.getItemData().type === "directory",
    onPrimaryAction: (item) => {
      const data = item.getItemData();
      if (data.kind !== "entry" || data.type !== "file") return;
      // 文件树始终先展示磁盘中的当前文件，变更信息只用于弹窗内按需切换 Diff。
      onOpenProjectFile(data.path, fileChangesByPath.get(data.path));
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
    async (directoryPath: string | null, optimistic = false, serverTree?: ProjectFileTree) => {
      const queryKey = ["projects", projectId, projectPath, "file-tree", directoryPath] as const;
      if (serverTree === undefined) await queryClient.invalidateQueries({ exact: true, queryKey, refetchType: "none" });
      else queryClient.setQueryData(queryKey, serverTree);
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
                client={client}
                item={item}
                onOpenProjectPath={onOpenProjectPath}
                onReferenceProjectPath={onReferenceProjectPath}
                onRefreshDirectory={(path, serverTree) => {
                  return refreshDirectory(path, false, serverTree);
                }}
                onRefreshProject={refreshProject}
                onSelect={(id) => {
                  setSelectedItemsState([id]);
                }}
                projectOpenApps={projectOpenApps}
                projectOpenPending={projectOpenPending}
                projectId={projectId}
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
