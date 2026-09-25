import { buildNativeAssetUrl } from "@/platform/native-asset-url.js";
import { type HostFileKind, type HostFileListing } from "@/protocol/index.js";
import { useQueries, useQuery } from "@tanstack/react-query";
import { FilePlus2, ImagePlus, LoaderCircle, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useTranslation } from "../../../i18n/i18n.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import {
  FileTree,
  FileTreeFile,
  FileTreeFolder,
} from "../../../shared/components/agent/file-tree.js";
import type { PromptInputAttachment } from "../../../shared/components/agent/prompt-input.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/components/core/dialog.js";
import type { NativeHostAttachmentClient } from "../../projects/project-queries.js";
import { FilesystemPickerToolbar } from "../../projects/components/filesystem-picker-toolbar.js";
import { resolveIdempotencyAttempt, type IdempotencyAttempt } from "../composer-state.js";

export type HostFileDirectoryState = Readonly<{
  data?: HostFileListing;
  error: Error | null;
  isFetching: boolean;
  path: string;
}>;

type HostFileNodesProps = Readonly<{
  directoryStates: ReadonlyMap<string, HostFileDirectoryState>;
  entries: HostFileListing["entries"];
  expandedPaths: Set<string>;
  kind: HostFileKind;
  onRetry: (path: string) => void;
}>;

function isVisibleHostEntry(entry: HostFileListing["entries"][number], kind: HostFileKind) {
  return entry.type === "directory" || kind === "file" || isImageFileName(entry.name);
}

function isImageFileName(name: string): boolean {
  return /\.(?:gif|jpe?g|png|webp)$/iu.test(name);
}

function HostFileNodes({
  directoryStates,
  entries,
  expandedPaths,
  kind,
  onRetry,
}: HostFileNodesProps) {
  const { t } = useTranslation("workbench");
  // 通用文件作为路径引用交给 Codex 工具读取，图片入口只展示原生支持的格式。
  return entries.filter((entry) => isVisibleHostEntry(entry, kind)).map((entry) => {
    if (entry.type === "file") {
      return <FileTreeFile key={entry.path} name={entry.name} path={entry.path} />;
    }
    const state = directoryStates.get(entry.path);
    const isExpanded = expandedPaths.has(entry.path);
    return (
      <FileTreeFolder
        key={entry.path}
        name={entry.name}
        path={entry.path}
        trailing={
          isExpanded && state?.isFetching === true ? (
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
          ) : undefined
        }
      >
        {!isExpanded ? null : state?.error !== null && state?.error !== undefined ? (
          <div className="flex min-h-9 items-center justify-between gap-2 px-2 py-1">
            <p className="min-w-0 text-caption text-danger" role="alert">
              {t("hostAttachmentPicker.loadBranchError")}
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
            {t("hostAttachmentPicker.loadingBranch")}
          </p>
        ) : !state.data.entries.some((entry) => isVisibleHostEntry(entry, kind)) ? (
          <p className="px-2 py-1.5 text-caption text-muted-foreground">
            {t("hostAttachmentPicker.empty")}
          </p>
        ) : (
          <HostFileNodes
            directoryStates={directoryStates}
            entries={state.data.entries}
            expandedPaths={expandedPaths}
            kind={kind}
            onRetry={onRetry}
          />
        )}
      </FileTreeFolder>
    );
  });
}

type HostFileTreeProps = Readonly<{
  directoryStates: readonly HostFileDirectoryState[];
  expandedPaths: Set<string>;
  listing: HostFileListing;
  kind: HostFileKind;
  onExpandedChange: (paths: Set<string>) => void;
  onRetry: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath?: string;
}>;

export function HostFileTree({
  directoryStates,
  expandedPaths,
  listing,
  kind,
  onExpandedChange,
  onRetry,
  onSelect,
  selectedPath,
}: HostFileTreeProps) {
  const { t } = useTranslation("workbench");
  const directoryStateMap = useMemo(
    () => new Map(directoryStates.map((state) => [state.path, state])),
    [directoryStates],
  );
  return (
    <FileTree
      aria-label={t("hostAttachmentPicker.treeLabel")}
      expanded={expandedPaths}
      onExpandedChange={onExpandedChange}
      onSelect={onSelect}
      {...(selectedPath === undefined ? {} : { selectedPath })}
    >
      <HostFileNodes
        directoryStates={directoryStateMap}
        entries={listing.entries}
        expandedPaths={expandedPaths}
        kind={kind}
        onRetry={onRetry}
      />
    </FileTree>
  );
}

type HostAttachmentPickerDialogProps = Readonly<{
  client: NativeHostAttachmentClient;
  kind: HostFileKind;
  onAdd: (attachment: PromptInputAttachment) => void;
  onClose: () => void;
  projectId: string;
}>;

export function HostAttachmentPickerDialog({
  client,
  kind,
  onAdd,
  onClose,
  projectId,
}: HostAttachmentPickerDialogProps) {
  const { t } = useTranslation("workbench");
  const [rootPath, setRootPath] = useState<string>();
  const [pathDraft, setPathDraft] = useState<string>();
  const [includeHidden, setIncludeHidden] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string>();
  const [isImporting, setIsImporting] = useState(false);
  const importLockRef = useRef(false);
  const importAttemptRef = useRef<IdempotencyAttempt | undefined>(undefined);
  const rootQuery = useQuery({
    queryFn: ({ signal }) => client.listHostFiles(kind, rootPath, { includeHidden, signal }),
    queryKey: ["host-files", kind, rootPath ?? null, includeHidden] as const,
    staleTime: 30_000,
  });
  const listing = rootQuery.data;
  const expandedDirectoryPaths = useMemo(() => [...expandedPaths], [expandedPaths]);
  const directoryQueries = useQueries({
    queries: expandedDirectoryPaths.map((path) => ({
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        client.listHostFiles(kind, path, { includeHidden, signal }),
      queryKey: ["host-files", kind, path, includeHidden] as const,
      staleTime: 30_000,
    })),
  });
  const directoryStates = expandedDirectoryPaths.map<HostFileDirectoryState>((path, index) => {
    const query = directoryQueries[index];
    return {
      ...(query?.data === undefined ? {} : { data: query.data }),
      error: query?.error ?? null,
      isFetching: query?.isFetching ?? false,
      path,
    };
  });
  const filePaths = useMemo(
    () =>
      new Set(
        [listing, ...directoryStates.map((state) => state.data)]
          .filter((value): value is HostFileListing => value !== undefined)
          .flatMap((value) =>
            value.entries.flatMap((entry) =>
              entry.type === "file" && isVisibleHostEntry(entry, kind) ? [entry.path] : [],
            ),
          ),
      ),
    [directoryStates, kind, listing],
  );
  const displayedPath = pathDraft ?? rootPath ?? listing?.path ?? "";

  const navigateToParent = () => {
    const parentPath = listing?.parentPath;
    if (parentPath === null || parentPath === undefined) return;
    // 切换浏览根目录时丢弃上一层的选择，避免确认不可见文件。
    setRootPath(parentPath);
    setPathDraft(undefined);
    setExpandedPaths(new Set());
    setSelectedPath(undefined);
  };
  const navigateToRoot = (path: string) => {
    setRootPath(path);
    setPathDraft(undefined);
    setExpandedPaths(new Set());
    setSelectedPath(undefined);
  };
  const navigateToPath = () => {
    const path = displayedPath.trim();
    if (path.length === 0) return;
    // 手动导航与树导航保持同一状态重置规则，避免确认旧目录中的文件。
    setRootPath(path);
    setPathDraft(undefined);
    setExpandedPaths(new Set());
    setSelectedPath(undefined);
  };
  const toggleHiddenFiles = () => {
    setIncludeHidden((current) => !current);
    setSelectedPath(undefined);
  };
  const importSelectedFile = async () => {
    if (selectedPath === undefined || importLockRef.current) return;
    importLockRef.current = true;
    setIsImporting(true);
    // 同一路径失败重试必须复用幂等键，切换文件后再创建新的导入尝试。
    const attempt = resolveIdempotencyAttempt(
      importAttemptRef.current,
      `${projectId}:${kind}:${selectedPath}`,
    );
    importAttemptRef.current = attempt;
    try {
      const response = await client.importHostAttachment(projectId, kind, selectedPath, {
        idempotencyKey: attempt.key,
      });
      if (response.attachment.kind !== kind) {
        throw new TypeError("Imported attachment kind does not match the selection");
      }
      const importedAttachment =
        kind === "image"
          ? { ...response.attachment, detail: "auto" as const }
          : response.attachment;
      onAdd({
        attachment: importedAttachment,
        ...importedAttachment,
        previewUrl:
          kind === "image" ? buildNativeAssetUrl(response.attachment.id) : "",
        source: "host",
      });
      importAttemptRef.current = undefined;
      notifyActionSuccess();
    } catch (error) {
      notifyActionError(error);
    } finally {
      importLockRef.current = false;
      setIsImporting(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isImporting) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby="host-attachment-picker-title"
        className="grid h-[min(84dvh,42rem)] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          if (isImporting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isImporting) event.preventDefault();
        }}
      >
        <DialogHeader className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
          <DialogTitle id="host-attachment-picker-title">
            {t(
              kind === "image"
                ? "hostAttachmentPicker.imageTitle"
                : "hostAttachmentPicker.fileTitle",
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("hostAttachmentPicker.description")}
          </DialogDescription>
        </DialogHeader>

        <FilesystemPickerToolbar
          disabled={isImporting}
          includeHidden={includeHidden}
          labels={{
            filesystemRoot: t("hostAttachmentPicker.filesystemRoot"),
            goToPath: t("hostAttachmentPicker.goToPath"),
            hideHidden: t("hostAttachmentPicker.hideHidden"),
            parent: t("hostAttachmentPicker.parent"),
            pathLabel: t("hostAttachmentPicker.pathLabel"),
            pathPlaceholder: t("hostAttachmentPicker.pathPlaceholder"),
            showHidden: t("hostAttachmentPicker.showHidden"),
          }}
          listing={listing}
          onNavigateParent={navigateToParent}
          onNavigatePath={navigateToPath}
          onNavigateRoot={navigateToRoot}
          onPathChange={setPathDraft}
          onToggleHidden={toggleHiddenFiles}
          path={displayedPath}
        />

        <div className="min-h-0 overflow-y-auto px-3 py-2 sm:px-4">
          {rootQuery.isPending ? (
            <p
              className="flex min-h-32 items-center justify-center gap-2 text-body-small text-muted-foreground"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {t("hostAttachmentPicker.loading")}
            </p>
          ) : rootQuery.error !== null ? (
            <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
              <p className="text-body-small text-danger" role="alert">
                {t("hostAttachmentPicker.loadError")}
              </p>
              <Button onClick={() => void rootQuery.refetch()} type="button" variant="outline">
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                {t("actions.retry")}
              </Button>
            </div>
          ) : listing === undefined ? null : !listing.entries.some((entry) =>
              isVisibleHostEntry(entry, kind),
            ) ? (
            <p className="grid min-h-32 place-items-center text-body-small text-muted-foreground">
              {t("hostAttachmentPicker.empty")}
            </p>
          ) : (
            <HostFileTree
              directoryStates={directoryStates}
              expandedPaths={expandedPaths}
              kind={kind}
              listing={listing}
              onExpandedChange={setExpandedPaths}
              onRetry={(path) => {
                const index = expandedDirectoryPaths.indexOf(path);
                void directoryQueries[index]?.refetch();
              }}
              onSelect={(path) => {
                if (filePaths.has(path)) {
                  setSelectedPath(path);
                }
              }}
              {...(selectedPath === undefined ? {} : { selectedPath })}
            />
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-separator bg-raised px-5 py-3">
          <div className="min-w-0 max-w-80">
            <p
              aria-live="polite"
              className="truncate font-mono text-caption text-foreground"
              title={selectedPath}
            >
              {selectedPath ?? t("hostAttachmentPicker.noSelection")}
            </p>
          </div>
          <DialogFooter className="shrink-0 flex-row">
            <Button
              className="h-8 shrink-0"
              disabled={isImporting}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              {t("actions.cancel")}
            </Button>
            <Button
              className="h-8 shrink-0"
              disabled={selectedPath === undefined || isImporting}
              onClick={() => void importSelectedFile()}
              type="button"
            >
              {isImporting ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : kind === "image" ? (
                <ImagePlus aria-hidden="true" data-icon="inline-start" />
              ) : (
                <FilePlus2 aria-hidden="true" data-icon="inline-start" />
              )}
              {t(isImporting ? "hostAttachmentPicker.importing" : "hostAttachmentPicker.add")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
