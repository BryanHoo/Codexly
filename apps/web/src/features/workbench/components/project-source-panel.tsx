import { SourceHeader, getFileName, type SourceHeaderProps } from "./project-source-header.js";
import { useRouter } from "@tanstack/react-router";
import {
  blockTextEditorNavigation,
  type TextEditorNavigation,
} from "@codexly/frontend-core/text-editor-navigation";
import type { TextFileEditorLabels } from "@codexly/frontend-core/text-file-editor";
import { useInlineTextFile } from "@codexly/ui/core/inline-text-file";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { PdfPreview } from "@codexly/ui/core/pdf-preview";
import { useInfiniteQuery } from "@tanstack/react-query";
import { buildProjectPdfFileUrl, buildProjectImageFileUrl } from "@codexly/client";
import type { ProjectSourceFile } from "@codexly/protocol";
import { Code2, Eye } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";

import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
import {
  getMarkdownPreviewPreferenceStorage,
  readMarkdownPreviewPreference,
  writeMarkdownPreviewPreference,
} from "../markdown-preview-preference.js";
import { CodeBlock, CodeBlockCopyButton } from "../../../shared/components/agent/code-block.js";
import { LazyMessageResponse } from "../../../shared/components/agent/lazy-message-response.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { getCodeLanguage } from "../../../shared/components/agent/code-languages.js";
import { Button } from "../../../shared/components/core/button.js";
import { ImagePreview } from "../../../shared/components/core/image-preview.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../shared/components/core/tooltip.js";
import { useTranslation } from "../../../i18n/i18n.js";

export { getCodeLanguage } from "../../../shared/components/agent/code-languages.js";

type ProjectSourcePanelProps = Readonly<{
  client: CodexlyWorkbenchClient;
  onClose?: () => void;
  onOpenDiff?: () => void;
  previewKind: "image" | "source" | "pdf";
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
}>;

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
  onClose,
  onOpenDiff,
  previewKind,
  projectId,
  reference,
  rootPath,
}: ProjectSourcePanelProps) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const router = useRouter({ warn: false }) as { history: TextEditorNavigation } | undefined;
  const contentRef = useRef<HTMLElement>(null);
  const [preferMarkdownPreview, setPreferMarkdownPreview] = useState(() =>
    readMarkdownPreviewPreference(getMarkdownPreviewPreferenceStorage()),
  );
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
  const sourcePath = sourceData?.path ?? reference.path;
  const sourceContent = sourceData?.content ?? "";
  const fileName = getFileName(sourcePath);
  const imageUrl = buildProjectImageFileUrl("", projectId, reference.path, rootPath);
  const sourceLanguage = getCodeLanguage(sourcePath);
  const isMarkdown = sourceLanguage === "markdown" || sourceLanguage === "mdx";
  const canRenderMarkdown = isMarkdown && sourceData?.nextCursor === null;
  const showRenderedMarkdown = canRenderMarkdown && preferMarkdownPreview;

  const editor = useInlineTextFile({
    enabled: previewKind === "source" && rootPath !== undefined && !showRenderedMarkdown,
    fileKey: JSON.stringify([projectId, rootPath, reference.path]),
    scope: client,
    lineNumber: reference.lineNumber,
    read: (signal) => client.readProjectTextFile(projectId, rootPath, reference.path, { signal }),
    checkRevision: (signal) =>
      client.readProjectTextFileRevision(projectId, rootPath, reference.path, { signal }),
    save: (input) => client.saveProjectTextFile(projectId, rootPath, input),
    notify: (result) => {
      const labels = t("textEditor", { returnObjects: true }) as TextFileEditorLabels;
      const message =
        result === "saved"
          ? labels.saved
          : result === "conflict"
            ? labels.conflict
            : result === "load-error"
              ? labels.loadError
              : labels.saveError;
      // 仅显示文件名，与提示使用同一段文字，只有宽度不足时才换行，长文件名也不会撑破提示。
      const text = (
        <span className="whitespace-normal [overflow-wrap:anywhere]">
          {getFileName(reference.path)} {message}
        </span>
      );
      if (result === "saved") toast.success(text);
      else toast.error(text);
    },
    onSaved: () => {
      // 只刷新当前文件与根目录状态，不触发聊天或整个项目的重新加载。
      void queryClient.invalidateQueries({
        queryKey: ["projects", projectId],
        predicate: (query) =>
          query.queryKey.includes(rootPath) &&
          ((query.queryKey.includes("source-file") && query.queryKey.at(-1) === reference.path) ||
            query.queryKey.some(
              (part) => typeof part === "string" && part.startsWith("git-status"),
            )),
      });
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;
  useEffect(() => {
    if (router)
      return blockTextEditorNavigation(
        router.history,
        () => editorRef.current.hasUnsavedChanges(),
        () => editorRef.current.flush(),
      );
  }, [router]);
  useEffect(() => {
    const lineNumber = reference.lineNumber;
    if (sourceData === undefined || lineNumber === null || showRenderedMarkdown || editor.ready) {
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
    editor.ready,
    fetchNextSourcePage,
    hasNextSourcePage,
    isFetchingNextSourcePage,
    reference.lineNumber,
    sourceData,
    showRenderedMarkdown,
  ]);
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
    ...(onClose === undefined
      ? {}
      : {
          onClose: () => {
            editor.runAfterSave(onClose);
          },
        }),
    ...(onOpenDiff === undefined
      ? {}
      : {
          onOpenDiff: () => {
            editor.runAfterSave(onOpenDiff);
          },
        }),
    previewKind,
    sourcePath,
    sourceStatus,
  };
  const handleSourceScroll = (event: UIEvent<HTMLElement>) => {
    if (
      previewKind !== "source" ||
      editor.ready ||
      !hasNextSourcePage ||
      isFetchingNextSourcePage
    ) {
      return;
    }
    const scrollTarget = event.target;
    if (!(scrollTarget instanceof HTMLElement) || !shouldLoadNextSourcePage(scrollTarget)) return;
    void fetchNextSourcePage();
  };
  const updateMarkdownPreviewPreference = (preview: boolean) => {
    editor.runAfterSave(() => {
      setPreferMarkdownPreview(preview);
      writeMarkdownPreviewPreference(preview, getMarkdownPreviewPreferenceStorage());
    });
  };

  return (
    <section
      aria-label={sourcePath}
      className="h-full min-h-0 bg-raised"
      onScrollCapture={handleSourceScroll}
      ref={contentRef}
    >
      {previewKind === "pdf" ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader {...headerProps} />
          <PdfPreview
            name={fileName}
            src={buildProjectPdfFileUrl("", projectId, reference.path, rootPath)}
            labels={{
              open: t("projectDialog.pdfOpen"),
              unavailable: t("projectDialog.pdfUnavailable"),
            }}
          />
        </div>
      ) : previewKind === "image" ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader {...headerProps} />
          <ImagePreview alt={fileName} src={imageUrl} />
        </div>
      ) : editor.ready ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader
            {...headerProps}
            sourceStatus={null}
            actions={
              <>
                {isMarkdown ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("projectDialog.previewMarkdown")}
                        onClick={() => {
                          updateMarkdownPreviewPreference(true);
                        }}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("projectDialog.previewMarkdown")}</TooltipContent>
                  </Tooltip>
                ) : null}
                <CodeBlockCopyButton getText={editor.getContent} />
              </>
            }
          />
          {editor.element}
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
