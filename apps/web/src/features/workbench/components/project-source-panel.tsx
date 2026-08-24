import { useInfiniteQuery } from "@tanstack/react-query";
import { buildProjectImageFileUrl } from "@codexly/client";
import type { ProjectSourceFile } from "@codexly/protocol";
import { Code2, Eye, FileCode2, Image } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";

import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
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
  client: CodexlyWorkbenchClient;
  previewKind: "image" | "source";
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
}>;

function getFileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

type SourceHeaderProps = Readonly<{
  actions?: ReactNode;
  lineNumber: number | null;
  previewKind: "image" | "source";
  sourcePath: string;
  sourceStatus: "error" | "loading" | "partial" | null;
}>;

function SourceHeader({
  actions,
  lineNumber,
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
      <CodeBlockActions>{actions}</CodeBlockActions>
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

export function ProjectSourcePanel({
  client,
  previewKind,
  projectId,
  reference,
  rootPath,
}: ProjectSourcePanelProps) {
  const { t } = useTranslation("workbench");
  const contentRef = useRef<HTMLElement>(null);
  // 渲染状态绑定源文件路径，切换文件或关闭标签后必须回到原始内容。
  const [renderedMarkdownPath, setRenderedMarkdownPath] = useState<string | null>(null);
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
      client.readProjectSourceFile(projectId, rootPath, reference.path, pageParam, { signal }),
    queryKey: ["projects", projectId, rootPath ?? null, "source-file", reference.path] as const,
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
  }, [previewKind, reference.path]);

  useEffect(() => {
    const lineNumber = reference.lineNumber;
    if (
      sourceData === undefined ||
      lineNumber === null ||
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
    reference.lineNumber,
    renderedMarkdownPath,
    sourceData,
  ]);

  const sourcePath = sourceData?.path ?? reference.path;
  const sourceContent = sourceData?.content ?? "";
  const fileName = getFileName(sourcePath);
  const imageUrl = buildProjectImageFileUrl("", projectId, reference.path, rootPath);
  const sourceLanguage = getCodeLanguage(sourcePath);
  const isMarkdown = sourceLanguage === "markdown" || sourceLanguage === "mdx";
  const canRenderMarkdown = isMarkdown && sourceData?.nextCursor === null;
  const showRenderedMarkdown = canRenderMarkdown && renderedMarkdownPath === sourcePath;
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

  return (
    <section
      aria-label={sourcePath}
      className="h-full min-h-0 bg-raised"
      onScrollCapture={handleSourceScroll}
      ref={contentRef}
    >
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
            <LazyMessageResponse className="mx-auto max-w-4xl">{sourceContent}</LazyMessageResponse>
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
  );
}
