import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ProjectSourceFile } from "@/protocol/index.js";
import { Code2, Eye, FileCode2, Image, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode, type UIEvent } from "react";

import type { NativeSourceFileClient } from "../../projects/project-query-contracts.js";
import {
  getMarkdownPreviewPreferenceStorage,
  readMarkdownPreviewPreference,
  writeMarkdownPreviewPreference,
} from "../markdown-preview-preference.js";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "../../../shared/components/agent/code-block.js";
import { LazyMessageResponse } from "../../../shared/components/agent/lazy-message-response.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { getCodeLanguage } from "../../../shared/components/agent/code-languages.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";

export { getCodeLanguage } from "../../../shared/components/agent/code-languages.js";

type ProjectSourcePanelProps = Readonly<{
  client: NativeSourceFileClient;
  headerActions?: ReactNode;
  onClose?: () => void;
  previewKind: "image" | "source";
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
  taskId?: string;
}>;

function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

type SourceHeaderProps = Readonly<{
  actions?: ReactNode;
  lineNumber: number | null;
  onClose?: () => void;
  previewKind: "image" | "source";
  sourcePath: string;
  sourceStatus: "error" | "loading" | "partial" | null;
}>;

function SourceHeader({
  actions,
  lineNumber,
  onClose,
  previewKind,
  sourcePath,
  sourceStatus,
}: SourceHeaderProps) {
  const { t } = useTranslation("workbench");
  return (
    <CodeBlockHeader className="min-h-toolbar gap-3 overflow-hidden bg-raised px-3 shadow-toolbar sm:px-4">
      <CodeBlockTitle className="w-0 flex-1 overflow-hidden">
        {previewKind === "image" ? (
          <Image className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-0 flex-1 overflow-hidden">
              <h2 className="truncate text-body-small font-semibold">
                <CodeBlockFilename>
                  {getFileName(sourcePath)}
                  {lineNumber === null ? null : ` (line ${String(lineNumber)})`}
                </CodeBlockFilename>
              </h2>
              <p className="truncate text-caption text-muted-foreground">{sourcePath}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent className="break-all">{sourcePath}</TooltipContent>
        </Tooltip>
      </CodeBlockTitle>
      {sourceStatus === null ? null : (
        <span
          className={`shrink-0 text-label ${sourceStatus === "error" ? "text-danger" : "text-warning"}`}
          role={sourceStatus === "error" ? "alert" : "status"}
        >
          {t(
            sourceStatus === "loading"
              ? "projectDialog.loadingMoreSource"
              : sourceStatus === "error"
                ? "projectDialog.loadMoreSourceError"
                : "projectDialog.sourcePartial",
          )}
        </span>
      )}
      <CodeBlockActions>
        {actions}
        {onClose === undefined ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t(
                  previewKind === "image"
                    ? "projectDialog.closeImagePreview"
                    : "projectDialog.closeSource",
                )}
                onClick={onClose}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t(
                previewKind === "image"
                  ? "projectDialog.closeImagePreview"
                  : "projectDialog.closeSource",
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </CodeBlockActions>
    </CodeBlockHeader>
  );
}

const SOURCE_LOAD_MORE_THRESHOLD_PX = 400;

type SourceScrollMetrics = Readonly<{
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
}>;

export function shouldLoadNextSourcePage(metrics: SourceScrollMetrics): boolean {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= SOURCE_LOAD_MORE_THRESHOLD_PX
  );
}

export function getNextSourceCursor(
  lastPage: ProjectSourceFile,
  lastPageParam: number | undefined,
): number | undefined {
  return lastPage.nextCursor === null || lastPage.nextCursor === lastPageParam
    ? undefined
    : lastPage.nextCursor;
}

export function ProjectSourcePanel({
  client,
  headerActions,
  onClose,
  previewKind,
  projectId,
  reference,
  rootPath,
  taskId,
}: ProjectSourcePanelProps) {
  const { t } = useTranslation("workbench");
  const [preferMarkdownPreview, setPreferMarkdownPreview] = useState(() =>
    readMarkdownPreviewPreference(getMarkdownPreviewPreferenceStorage()),
  );
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const sourceQuery = useInfiniteQuery({
    enabled: previewKind === "source",
    getNextPageParam: (
      lastPage: ProjectSourceFile,
      _pages: ProjectSourceFile[],
      lastPageParam: number | undefined,
    ) => getNextSourceCursor(lastPage, lastPageParam),
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }): Promise<ProjectSourceFile> =>
      client.readProjectSourceFile(projectId, rootPath, reference.path, pageParam, {
        signal,
        ...(taskId === undefined ? {} : { taskId }),
      }),
    queryKey: [
      "projects",
      projectId,
      taskId ?? null,
      rootPath ?? null,
      "source-file",
      reference.path,
    ] as const,
    staleTime: 30_000,
  });
  const imageQuery = useQuery({
    enabled: previewKind === "image",
    queryFn: ({ signal }) =>
      client.cacheProjectImage(projectId, rootPath, reference.path, {
        signal,
        ...(taskId === undefined ? {} : { taskId }),
      }),
    queryKey: [
      "projects",
      projectId,
      taskId ?? null,
      rootPath ?? null,
      "image-file",
      reference.path,
    ] as const,
    staleTime: 30_000,
  });
  const sourcePages = sourceQuery.data?.pages;
  const sourcePageParams = sourceQuery.data?.pageParams;
  const fetchNextSourcePage = sourceQuery.fetchNextPage;
  const hasNextSourcePage = sourceQuery.hasNextPage;
  const isFetchingNextSourcePage = sourceQuery.isFetchingNextPage;
  const sourceCodePages = useMemo(
    () =>
      sourcePages?.map((page, index) => ({
        code: page.content,
        key: `${String(index)}:${JSON.stringify(sourcePageParams?.[index] ?? "initial")}`,
      })) ?? [],
    [sourcePageParams, sourcePages],
  );
  const firstSourcePage = sourcePages?.[0];
  const lastSourcePage = sourcePages?.at(-1);
  const sourcePath = firstSourcePage?.path ?? reference.path;
  const fileName = getFileName(sourcePath);
  const imageUrl = imageQuery.data ?? "";
  const sourceLanguage = getCodeLanguage(sourcePath);
  const isMarkdown = sourceLanguage === "markdown" || sourceLanguage === "mdx";
  const canRenderMarkdown = isMarkdown && lastSourcePage?.nextCursor === null;
  const showRenderedMarkdown = canRenderMarkdown && preferMarkdownPreview;
  const sourceContent = useMemo(
    () => (showRenderedMarkdown ? (sourcePages?.map((page) => page.content).join("") ?? "") : ""),
    [showRenderedMarkdown, sourcePages],
  );

  useEffect(() => {
    setImageLoadFailed(false);
  }, [previewKind, reference.path]);

  const sourceStatus: SourceHeaderProps["sourceStatus"] =
    firstSourcePage === undefined
      ? null
      : isFetchingNextSourcePage
        ? "loading"
        : sourceQuery.isFetchNextPageError
          ? "error"
          : hasNextSourcePage
            ? "partial"
            : null;
  const headerProps = {
    lineNumber: reference.lineNumber,
    ...(onClose === undefined ? {} : { onClose }),
    previewKind,
    sourcePath,
    sourceStatus,
  };
  const handleSourceScroll = (event: UIEvent<HTMLElement>) => {
    if (previewKind !== "source" || !hasNextSourcePage || isFetchingNextSourcePage) {
      return;
    }
    const scrollTarget = event.target;
    if (!(scrollTarget instanceof HTMLElement) || !shouldLoadNextSourcePage(scrollTarget)) return;
    void fetchNextSourcePage();
  };
  const handleHighlightedLineUnavailable = useCallback(() => {
    // 目标行尚未加载时逐页补齐；虚拟列表在行可用后负责精确定位。
    if (hasNextSourcePage && !isFetchingNextSourcePage) void fetchNextSourcePage();
  }, [fetchNextSourcePage, hasNextSourcePage, isFetchingNextSourcePage]);
  const updateMarkdownPreviewPreference = (preview: boolean) => {
    setPreferMarkdownPreview(preview);
    writeMarkdownPreviewPreference(preview, getMarkdownPreviewPreferenceStorage());
  };

  return (
    <section
      aria-label={sourcePath}
      className="h-full min-h-0 bg-raised"
      onScrollCapture={handleSourceScroll}
    >
      {previewKind === "image" ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader {...headerProps} actions={headerActions} />
          <div className="grid min-h-0 place-items-center overflow-hidden p-4 sm:p-6">
            {imageQuery.isPending ? (
              <div className="text-body-small text-muted-foreground" role="status">
                {t("projectDialog.loadingSource")}
              </div>
            ) : imageLoadFailed || imageQuery.error !== null ? (
              <div className="text-body-small text-danger" role="alert">
                {t("projectDialog.loadImageError")}
              </div>
            ) : (
              <img
                alt={fileName}
                className="block size-full object-contain"
                decoding="async"
                onError={() => {
                  setImageLoadFailed(true);
                }}
                src={imageUrl}
              />
            )}
          </div>
        </div>
      ) : firstSourcePage === undefined && sourceQuery.isPending ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <SourceHeader {...headerProps} actions={headerActions} />
          <div
            className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
            role="status"
          >
            {t("projectDialog.loadingSource")}
          </div>
        </div>
      ) : firstSourcePage === undefined && sourceQuery.error !== null ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <SourceHeader {...headerProps} actions={headerActions} />
          <div
            className="grid min-h-48 place-items-center text-body-small text-danger"
            role="alert"
          >
            {t("projectDialog.loadSourceError")}
          </div>
        </div>
      ) : showRenderedMarkdown ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader
            {...headerProps}
            actions={
              <>
                {headerActions}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={t("projectDialog.showRawContent")}
                      onClick={() => {
                        updateMarkdownPreviewPreference(false);
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Code2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("projectDialog.showRawContent")}</TooltipContent>
                </Tooltip>
              </>
            }
          />
          <div className="min-h-0 overflow-auto px-5 py-4 sm:px-8 sm:py-6">
            <LazyMessageResponse className="mx-auto max-w-4xl">{sourceContent}</LazyMessageResponse>
          </div>
        </div>
      ) : (
        <CodeBlock
          className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-none bg-content shadow-none"
          highlightedLine={reference.lineNumber}
          language={sourceLanguage}
          onHighlightedLineUnavailable={handleHighlightedLineUnavailable}
          pages={sourceCodePages}
          showLineNumbers
        >
          <SourceHeader
            {...headerProps}
            actions={
              <>
                {headerActions}
                {canRenderMarkdown ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("projectDialog.previewMarkdown")}
                        onClick={() => {
                          updateMarkdownPreviewPreference(true);
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("projectDialog.previewMarkdown")}</TooltipContent>
                  </Tooltip>
                ) : null}
                <CodeBlockCopyButton />
              </>
            }
          />
        </CodeBlock>
      )}
    </section>
  );
}
