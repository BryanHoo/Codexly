import { useInfiniteQuery } from "@tanstack/react-query";
import { buildProjectImageFileUrl } from "@code-agent/client";
import type { ProjectSourceFile } from "@code-agent/protocol";
import { Code2, Eye, FileCode2, Image, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";

import type { CodeAgentWorkbenchClient } from "../../projects/project-queries.js";
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
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";

export { getCodeLanguage } from "../../../shared/components/agent/code-languages.js";

type ProjectSourceDialogProps = Readonly<{
  client: CodeAgentWorkbenchClient;
  onClose: () => void;
  previewKind: "image" | "source";
  projectId: string;
  reference: MessageFileReference | null;
  rootPath?: string;
}>;

function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

type SourceHeaderProps = Readonly<{
  actions?: ReactNode;
  lineNumber: number | null;
  onClose: () => void;
  previewKind: "image" | "source";
  sourcePath: string;
  titleId: string;
  sourceStatus: "error" | "loading" | "partial" | null;
}>;

function SourceHeader({
  actions,
  lineNumber,
  onClose,
  previewKind,
  sourcePath,
  titleId,
  sourceStatus,
}: SourceHeaderProps) {
  const { t } = useTranslation("workbench");
  return (
    <CodeBlockHeader className="min-h-toolbar gap-3 bg-raised px-3 shadow-toolbar sm:px-4">
      <CodeBlockTitle className="min-w-0 flex-1">
        {previewKind === "image" ? (
          <Image className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <DialogTitle asChild>
            <h2 className="truncate text-body-small font-semibold" id={titleId} title={sourcePath}>
              <CodeBlockFilename>
                {getFileName(sourcePath)}
                {lineNumber === null ? null : ` (line ${String(lineNumber)})`}
              </CodeBlockFilename>
            </h2>
          </DialogTitle>
          <p className="truncate text-caption text-muted-foreground" title={sourcePath}>
            {sourcePath}
          </p>
        </div>
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

export function mergeProjectSourcePages(
  pages: readonly ProjectSourceFile[],
): ProjectSourceFile | undefined {
  const firstPage = pages[0];
  const lastPage = pages.at(-1);
  if (firstPage === undefined || lastPage === undefined) return undefined;
  return {
    content: pages.map((page) => page.content).join(""),
    nextCursor: lastPage.nextCursor,
    path: firstPage.path,
  };
}

export function ProjectSourceDialog({
  client,
  onClose,
  previewKind,
  projectId,
  reference,
  rootPath,
}: ProjectSourceDialogProps) {
  const { t } = useTranslation("workbench");
  const contentRef = useRef<HTMLDivElement>(null);
  // 渲染状态绑定源文件路径，切换文件或关闭弹窗后必须回到原始内容。
  const [renderedMarkdownPath, setRenderedMarkdownPath] = useState<string | null>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const sourceQuery = useInfiniteQuery({
    enabled: reference !== null && previewKind === "source",
    getNextPageParam: (
      lastPage: ProjectSourceFile,
      _pages: ProjectSourceFile[],
      lastPageParam: number | undefined,
    ) => getNextSourceCursor(lastPage, lastPageParam),
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }): Promise<ProjectSourceFile> => {
      if (reference === null) {
        throw new Error("Source file reference is required");
      }
      return client.readProjectSourceFile(projectId, rootPath, reference.path, pageParam, {
        signal,
      });
    },
    queryKey: [
      "projects",
      projectId,
      rootPath ?? null,
      "source-file",
      reference?.path ?? null,
    ] as const,
    staleTime: 30_000,
  });
  const sourcePages = sourceQuery.data?.pages;
  const fetchNextSourcePage = sourceQuery.fetchNextPage;
  const hasNextSourcePage = sourceQuery.hasNextPage;
  const isFetchingNextSourcePage = sourceQuery.isFetchingNextPage;
  const sourceData = useMemo(
    () => (sourcePages === undefined ? undefined : mergeProjectSourcePages(sourcePages)),
    [sourcePages],
  );

  useEffect(() => {
    setImageLoadFailed(false);
  }, [previewKind, reference?.path]);

  useEffect(() => {
    const lineNumber = reference?.lineNumber;
    if (
      sourceData === undefined ||
      lineNumber === null ||
      lineNumber === undefined ||
      renderedMarkdownPath === sourceData.path
    ) {
      return;
    }

    // 行节点由共享 CodeBlock 提供，查询完成后让所有可滚动祖先共同定位目标行。
    const targetLine = contentRef.current?.querySelector(
      `[data-code-line="${String(lineNumber)}"]`,
    );
    if (targetLine !== null && targetLine !== undefined) {
      targetLine.scrollIntoView({ block: "center" });
      return;
    }
    // 文件引用可能指向首段之外；继续逐页读取，直到目标行出现或文件结束。
    if (hasNextSourcePage && !isFetchingNextSourcePage) {
      void fetchNextSourcePage();
    }
  }, [
    fetchNextSourcePage,
    hasNextSourcePage,
    isFetchingNextSourcePage,
    reference?.lineNumber,
    renderedMarkdownPath,
    sourceData,
  ]);

  if (reference === null) {
    return null;
  }

  const sourcePath = sourceData?.path ?? reference.path;
  const sourceContent = sourceData?.content ?? "";
  const fileName = getFileName(sourcePath);
  const imageUrl = buildProjectImageFileUrl("", projectId, reference.path, rootPath);
  const sourceLanguage = getCodeLanguage(sourcePath);
  const isMarkdown = sourceLanguage === "markdown" || sourceLanguage === "mdx";
  const canRenderMarkdown = isMarkdown && sourceData?.nextCursor === null;
  const showRenderedMarkdown = canRenderMarkdown && renderedMarkdownPath === sourcePath;
  const titleId = "project-source-dialog-title";
  const handleClose = () => {
    setRenderedMarkdownPath(null);
    onClose();
  };
  const sourceStatus: SourceHeaderProps["sourceStatus"] =
    sourceData === undefined
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
    onClose: handleClose,
    previewKind,
    sourcePath,
    titleId,
    sourceStatus,
  };
  const handleSourceScroll = (event: UIEvent<HTMLDivElement>) => {
    if (previewKind !== "source" || !hasNextSourcePage || isFetchingNextSourcePage) {
      return;
    }
    const scrollTarget = event.target;
    if (!(scrollTarget instanceof HTMLElement) || !shouldLoadNextSourcePage(scrollTarget)) return;
    void fetchNextSourcePage();
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby={titleId}
        className="h-[min(82dvh,54rem)] max-w-[72rem] overflow-hidden p-0"
        onEscapeKeyDown={(event) => {
          // 预览内可能存在 Tooltip 等可关闭层；当前 Dialog 始终优先响应 Escape。
          event.preventDefault();
          handleClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            handleClose();
          }
        }}
        onScrollCapture={handleSourceScroll}
        ref={contentRef}
      >
        <section className="h-full min-h-0 bg-raised">
          {previewKind === "image" ? (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
              <SourceHeader {...headerProps} />
              <div className="grid min-h-0 place-items-center overflow-hidden p-4 sm:p-6">
                {imageLoadFailed ? (
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
          ) : sourceData === undefined && sourceQuery.isPending ? (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <SourceHeader {...headerProps} />
              <div
                className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
                role="status"
              >
                {t("projectDialog.loadingSource")}
              </div>
            </div>
          ) : sourceData === undefined && sourceQuery.error !== null ? (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <SourceHeader {...headerProps} />
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("projectDialog.showRawContent")}
                        onClick={() => {
                          setRenderedMarkdownPath(null);
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
                }
              />
              <div className="min-h-0 overflow-auto px-5 py-4 sm:px-8 sm:py-6">
                <LazyMessageResponse className="mx-auto max-w-4xl">
                  {sourceContent}
                </LazyMessageResponse>
              </div>
            </div>
          ) : (
            <CodeBlock
              className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] rounded-none bg-content shadow-none"
              code={sourceContent}
              highlightedLine={reference.lineNumber}
              language={sourceLanguage}
              showLineNumbers
            >
              <SourceHeader
                {...headerProps}
                actions={
                  <>
                    {canRenderMarkdown ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={t("projectDialog.previewMarkdown")}
                            onClick={() => {
                              setRenderedMarkdownPath(sourcePath);
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
      </DialogContent>
    </Dialog>
  );
}
