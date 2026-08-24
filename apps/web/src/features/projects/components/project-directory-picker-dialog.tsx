import type { ProjectDirectoryListing } from "@code-agent/protocol";
import { useQueries, useQuery } from "@tanstack/react-query";
import { FolderPlus, LoaderCircle, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import { FileTree, FileTreeFolder } from "../../../shared/components/agent/file-tree.js";
import { Button } from "../../../shared/components/core/button.js";
import { Checkbox } from "../../../shared/components/core/checkbox.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import type { CodeAgentProjectDirectoryClient } from "../project-queries.js";
import { setProjectRootPathChecked } from "../project-root-selection.js";
import { FilesystemPickerToolbar } from "./filesystem-picker-toolbar.js";

export type ProjectDirectoryState = Readonly<{
  data?: ProjectDirectoryListing;
  error: Error | null;
  isFetching: boolean;
  path: string;
}>;

type ProjectDirectoryTreeProps = Readonly<{
  directoryStates: readonly ProjectDirectoryState[];
  expandedPaths: Set<string>;
  listing: ProjectDirectoryListing;
  onExpandedChange: (paths: Set<string>) => void;
  onRetry: (path: string) => void;
  onRootCheckedChange: (path: string, checked: boolean) => void;
  selectedPaths: ReadonlySet<string>;
  selectionDisabled?: boolean;
}>;

type ProjectDirectoryNodesProps = Readonly<{
  directoryStates: ReadonlyMap<string, ProjectDirectoryState>;
  entries: ProjectDirectoryListing["entries"];
  expandedPaths: Set<string>;
  onRetry: (path: string) => void;
  onRootCheckedChange: (path: string, checked: boolean) => void;
  selectedPaths: ReadonlySet<string>;
  selectionDisabled?: boolean;
}>;

function ProjectDirectoryNodes({
  directoryStates,
  entries,
  expandedPaths,
  onRetry,
  onRootCheckedChange,
  selectedPaths,
  selectionDisabled = false,
}: ProjectDirectoryNodesProps) {
  const { t } = useTranslation("workbench");
  return entries.map((entry) => {
    const state = directoryStates.get(entry.path);
    const isExpanded = expandedPaths.has(entry.path);
    return (
      <FileTreeFolder
        key={entry.path}
        name={entry.name}
        path={entry.path}
        selectionControl={
          <Checkbox
            aria-label={t("projectPicker.selectRoot", { name: entry.name })}
            checked={selectedPaths.has(entry.path)}
            disabled={selectionDisabled}
            onCheckedChange={(checked) => {
              onRootCheckedChange(entry.path, checked === true);
            }}
          />
        }
        trailing={
          isExpanded && state?.isFetching === true ? (
            <LoaderCircle
              aria-hidden="true"
              className="size-3.5 animate-spin text-muted-foreground"
            />
          ) : undefined
        }
      >
        {!isExpanded ? null : state?.error !== null && state?.error !== undefined ? (
          <div className="flex min-h-9 items-center justify-between gap-2 px-2 py-1">
            <p className="min-w-0 text-caption text-danger" role="alert">
              {t("projectPicker.loadBranchError")}
            </p>
            <Button
              className="shrink-0"
              onClick={() => {
                onRetry(entry.path);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              {t("actions.retry")}
            </Button>
          </div>
        ) : state?.data === undefined ? (
          <p className="px-2 py-1.5 text-caption text-muted-foreground" role="status">
            {t("projectPicker.loadingBranch")}
          </p>
        ) : state.data.entries.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-muted-foreground">
            {t("projectPicker.empty")}
          </p>
        ) : (
          <ProjectDirectoryNodes
            directoryStates={directoryStates}
            entries={state.data.entries}
            expandedPaths={expandedPaths}
            onRetry={onRetry}
            onRootCheckedChange={onRootCheckedChange}
            selectedPaths={selectedPaths}
            selectionDisabled={selectionDisabled}
          />
        )}
      </FileTreeFolder>
    );
  });
}

export function ProjectDirectoryTree({
  directoryStates,
  expandedPaths,
  listing,
  onExpandedChange,
  onRetry,
  onRootCheckedChange,
  selectedPaths,
  selectionDisabled = false,
}: ProjectDirectoryTreeProps) {
  const { t } = useTranslation("workbench");
  const directoryStateMap = useMemo(
    () => new Map(directoryStates.map((state) => [state.path, state])),
    [directoryStates],
  );
  return (
    <FileTree
      aria-label={t("projectPicker.treeLabel")}
      expanded={expandedPaths}
      onExpandedChange={onExpandedChange}
    >
      <ProjectDirectoryNodes
        directoryStates={directoryStateMap}
        entries={listing.entries}
        expandedPaths={expandedPaths}
        onRetry={onRetry}
        onRootCheckedChange={onRootCheckedChange}
        selectedPaths={selectedPaths}
        selectionDisabled={selectionDisabled}
      />
    </FileTree>
  );
}

type ProjectDirectoryPickerDialogProps = Readonly<{
  client: CodeAgentProjectDirectoryClient;
  isAdding: boolean;
  onAdd: (paths: readonly string[]) => Promise<void> | void;
  onClose: () => void;
}>;

export function ProjectDirectoryPickerDialog({
  client,
  isAdding,
  onAdd,
  onClose,
}: ProjectDirectoryPickerDialogProps) {
  const { t } = useTranslation("workbench");
  const [rootPath, setRootPath] = useState<string>();
  const [pathDraft, setPathDraft] = useState<string>();
  const [includeHidden, setIncludeHidden] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const rootQuery = useQuery({
    queryFn: ({ signal }) => client.listProjectDirectories(rootPath, { includeHidden, signal }),
    queryKey: ["project-directories", rootPath ?? null, includeHidden] as const,
    staleTime: 30_000,
  });
  const listing = rootQuery.data;
  const canAdd = listing !== undefined && selectedPaths.length > 0;
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const selectedRootsSummary = selectedPaths
    .map((path, index) => (index === 0 ? t("projectPicker.primaryRootSummary", { path }) : path))
    .join(t("projectPicker.rootSeparator"));
  const expandedDirectoryPaths = useMemo(() => [...expandedPaths], [expandedPaths]);
  // 仅为当前展开的节点创建 Query，折叠目录不会预读整棵主机文件树。
  const directoryQueries = useQueries({
    queries: expandedDirectoryPaths.map((path) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        client.listProjectDirectories(path, { includeHidden, signal }),
      queryKey: ["project-directories", path, includeHidden] as const,
      staleTime: 30_000,
    })),
  });
  const directoryStates = expandedDirectoryPaths.map<ProjectDirectoryState>((path, index) => {
    const query = directoryQueries[index];
    return {
      ...(query?.data === undefined ? {} : { data: query.data }),
      error: query?.error ?? null,
      isFetching: query?.isFetching ?? false,
      path,
    };
  });
  const displayedPath = pathDraft ?? rootPath ?? listing?.path ?? "";
  const navigateToParent = () => {
    const parentPath = listing?.parentPath;
    if (parentPath === null || parentPath === undefined) return;
    // 切换浏览根目录时同步清空旧分支状态，避免把另一层级的选择和展开形态带入新树。
    setRootPath(parentPath);
    setPathDraft(undefined);
    setExpandedPaths(new Set());
    setSelectedPaths([]);
  };
  const navigateToRoot = (path: string) => {
    setRootPath(path);
    setPathDraft(undefined);
    setExpandedPaths(new Set());
    setSelectedPaths([]);
  };
  const navigateToPath = () => {
    const path = displayedPath.trim();
    if (path.length === 0) return;
    // 手动导航先清除旧选择，等待 Server 返回规范化后的可添加目录。
    setRootPath(path);
    setPathDraft(undefined);
    setExpandedPaths(new Set());
    setSelectedPaths([]);
  };
  const toggleHiddenDirectories = () => {
    setIncludeHidden((current) => !current);
    setSelectedPaths([]);
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isAdding) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby="project-directory-picker-title"
        className="grid h-[min(84dvh,42rem)] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (isAdding) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isAdding) event.preventDefault();
        }}
      >
        <DialogHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <DialogTitle id="project-directory-picker-title">{t("projectPicker.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("projectPicker.description")}
          </DialogDescription>
        </DialogHeader>

        <FilesystemPickerToolbar
          disabled={isAdding}
          includeHidden={includeHidden}
          labels={{
            filesystemRoot: t("projectPicker.filesystemRoot"),
            goToPath: t("projectPicker.goToPath"),
            hideHidden: t("projectPicker.hideHidden"),
            parent: t("projectPicker.parent"),
            pathLabel: t("projectPicker.pathLabel"),
            pathPlaceholder: t("projectPicker.pathPlaceholder"),
            showHidden: t("projectPicker.showHidden"),
          }}
          listing={listing}
          onNavigateParent={navigateToParent}
          onNavigatePath={navigateToPath}
          onNavigateRoot={navigateToRoot}
          onPathChange={setPathDraft}
          onToggleHidden={toggleHiddenDirectories}
          path={displayedPath}
        />

        <div className="min-h-0 overflow-y-auto px-3 py-2 sm:px-4">
          {rootQuery.isPending ? (
            <p
              className="flex min-h-32 items-center justify-center gap-2 text-body-small text-muted-foreground"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {t("projectPicker.loading")}
            </p>
          ) : rootQuery.error !== null ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-body-small text-danger" role="alert">
                {t("projectPicker.loadError")}
              </p>
              <Button onClick={() => void rootQuery.refetch()} type="button" variant="outline">
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {t("actions.retry")}
              </Button>
            </div>
          ) : listing === undefined ? null : listing.entries.length === 0 ? (
            <p className="grid min-h-32 place-items-center text-body-small text-muted-foreground">
              {t("projectPicker.empty")}
            </p>
          ) : (
            <ProjectDirectoryTree
              directoryStates={directoryStates}
              expandedPaths={expandedPaths}
              listing={listing}
              onExpandedChange={setExpandedPaths}
              onRetry={(path) => {
                const index = expandedDirectoryPaths.indexOf(path);
                void directoryQueries[index]?.refetch();
              }}
              onRootCheckedChange={(path, checked) => {
                // 目录行只负责浏览；checkbox 独立维护有序 Project 根目录选择。
                setSelectedPaths((current) => setProjectRootPathChecked(current, path, checked));
              }}
              selectedPaths={selectedPathSet}
              selectionDisabled={isAdding}
            />
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-separator bg-raised px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p aria-live="polite" className="text-caption text-muted-foreground">
                {t("projectPicker.selectedRoots", { count: selectedPaths.length })}
              </p>
              <p className="ml-auto text-right text-caption text-muted-foreground">
                {t("projectPicker.primaryRootHint")}
              </p>
            </div>
            {selectedRootsSummary.length === 0 ? null : (
              <p className="min-w-0 break-words font-mono text-caption text-foreground [overflow-wrap:anywhere]">
                {selectedRootsSummary}
              </p>
            )}
          </div>
          <DialogFooter className="w-full flex-col-reverse sm:w-auto sm:flex-row">
            <Button
              className="h-10 w-full sm:h-8 sm:w-auto"
              disabled={isAdding}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              {t("actions.cancel")}
            </Button>
            <Button
              className="h-10 w-full sm:h-8 sm:w-auto"
              disabled={!canAdd || isAdding}
              onClick={() => {
                if (selectedPaths.length > 0) void onAdd(selectedPaths);
              }}
              type="button"
            >
              {isAdding ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <FolderPlus aria-hidden="true" data-icon="inline-start" />
              )}
              {t(isAdding ? "projectPicker.adding" : "projectPicker.add")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
