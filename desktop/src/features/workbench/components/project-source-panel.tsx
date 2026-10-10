import { SourceHeader, getFileName, type SourceHeaderProps } from "./project-source-header.js";
import { useRouter } from "@tanstack/react-router";
import {
  blockTextEditorNavigation,
  type TextEditorNavigation,
} from "@codexly/frontend-core/text-editor-navigation";
import { registerTextEditorCloseGuard } from "../../../platform/tauri/text-editor-close-guard.js";
import type { TextFileEditorLabels } from "@codexly/frontend-core/text-file-editor";
import { useInlineTextFile } from "@codexly/ui/core/inline-text-file";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { notifyActionError } from "../../notifications/action-notifications.js";
import { PdfPreview } from "@codexly/ui/core/pdf-preview";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { ProjectSourceFile } from "@/protocol/index.js";
import { Code2, Eye } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
  type UIEvent,
} from "react";

import type { NativeSourceFileClient } from "../../projects/project-query-contracts.js";
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
  client: NativeSourceFileClient;
  headerActions?: ReactNode;
  onClose?: () => void;
  previewKind: "image" | "source" | "pdf";
  projectId: string;
  reference: MessageFileReference;
  rootPath?: string;
  taskId?: string;
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
  const queryClient = useQueryClient();
  const router = useRouter({ warn: false }) as { history: TextEditorNavigation } | undefined;
  const [preferMarkdownPreview, setPreferMarkdownPreview] = useState(() =>
    readMarkdownPreviewPreference(getMarkdownPreviewPreferenceStorage()),
  );
  const editorEnabled = previewKind === "source" && rootPath !== undefined;
  const editor = useInlineTextFile({
    enabled: editorEnabled,
    fileKey: JSON.stringify([projectId, rootPath, reference.path]),
    scope: client,
    lineNumber: reference.lineNumber,
    registerCloseGuard: registerTextEditorCloseGuard,
    read: (signal) => client.readProjectTextFile(projectId, rootPath, reference.path, { signal }),
    checkRevision: (signal) => client.readProjectTextFileRevision(projectId, rootPath, reference.path, { signal }),
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
  // 可编辑文件只使用共享会话的全文；确认不能编辑或读取失败后才启用分页预览。
  const usePagedSource = previewKind === "source" && (!editorEnabled || editor.fallback);
  const sourceQuery = useInfiniteQuery({
    enabled: usePagedSource,
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
  const pdfQuery = useQuery({
    enabled: previewKind === "pdf",
    queryKey: ["projects", projectId, taskId ?? null, rootPath ?? null, "pdf-file", reference.path],
    queryFn: () =>
      client.getProjectPdfFileUrl(projectId, rootPath, reference.path, {
        ...(taskId === undefined ? {} : { taskId }),
      }),
    staleTime: 30_000,
    gcTime: 30_000,
    retry: false,
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
  const sourcePages = usePagedSource ? sourceQuery.data?.pages : undefined;
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
  const sourcePath = editor.path ?? firstSourcePage?.path ?? reference.path;
  const fileName = getFileName(sourcePath);
  const imageUrl = imageQuery.data ?? "";
  const sourceLanguage = getCodeLanguage(sourcePath);
  const isMarkdown = sourceLanguage === "markdown" || sourceLanguage === "mdx";
  const canRenderMarkdown = isMarkdown && (editor.ready || lastSourcePage?.nextCursor === null);
  const showRenderedMarkdown = canRenderMarkdown && preferMarkdownPreview;
  const getEditorContent = editor.getContent;
  const sourceContent = useMemo(
    () => {
      if (!showRenderedMarkdown) return "";
      if (editor.ready) return getEditorContent();
      return sourcePages?.map((page) => page.content).join("") ?? "";
    },
    [editor.ready, getEditorContent, showRenderedMarkdown, sourcePages],
  );

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
    ...(onClose === undefined ? {} : { onClose: () => editor.runAfterSave(onClose) }),
    previewKind,
    sourcePath,
    sourceStatus,
  };
  const handleSourceScroll = (event: UIEvent<HTMLElement>) => {
    if (
      !usePagedSource ||
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
  const handleHighlightedLineUnavailable = useCallback(() => {
    // 目标行尚未加载时逐页补齐；虚拟列表在行可用后负责精确定位。
    if (usePagedSource && hasNextSourcePage && !isFetchingNextSourcePage) void fetchNextSourcePage();
  }, [fetchNextSourcePage, hasNextSourcePage, isFetchingNextSourcePage, usePagedSource]);
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
    >
      {previewKind === "pdf" ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader {...headerProps} />
          {pdfQuery.data === undefined ? (
            <p
              className="grid min-h-0 place-items-center text-body-small"
              role={pdfQuery.isError ? "alert" : "status"}
            >
              {t(
                pdfQuery.isError ? "projectDialog.loadSourceError" : "projectDialog.loadingSource",
              )}
            </p>
          ) : (
            <PdfPreview
              name={fileName}
              src={pdfQuery.data}
              labels={{
                open: t("projectDialog.pdfOpen"),
                unavailable: t("projectDialog.pdfUnavailable"),
              }}
              onOpen={() => {
                void client
                  .openProject(projectId, rootPath, {
                    appId: "system-default",
                    path: reference.path,
                    ...(taskId === undefined ? {} : { taskId }),
                  })
                  .catch(notifyActionError);
              }}
            />
          )}
        </div>
      ) : previewKind === "image" ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader {...headerProps} actions={headerActions} />
          {imageQuery.isPending || imageQuery.error !== null ? (
            <div className="grid min-h-0 place-items-center overflow-hidden p-4 sm:p-6">
              {imageQuery.isPending ? (
                <div className="text-body-small text-muted-foreground" role="status">
                  {t("projectDialog.loadingSource")}
                </div>
              ) : (
                <div className="text-body-small text-danger" role="alert">
                  {t("projectDialog.loadImageError")}
                </div>
              )}
            </div>
          ) : (
            <ImagePreview alt={fileName} src={imageUrl} />
          )}
        </div>
      ) : editor.ready && !showRenderedMarkdown ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-content">
          <SourceHeader
            {...headerProps}
            sourceStatus={null}
            actions={
              <>
                {headerActions}
                {isMarkdown ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        aria-label={t("projectDialog.previewMarkdown")}
                        onClick={() => updateMarkdownPreviewPreference(true)}
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
      ) : editor.loading || (!editor.ready && firstSourcePage === undefined && sourceQuery.isPending) ? (
        <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <SourceHeader {...headerProps} actions={headerActions} />
          <div
            className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
            role="status"
          >
            {t("projectDialog.loadingSource")}
          </div>
        </div>
      ) : !editor.ready && firstSourcePage === undefined && sourceQuery.error !== null ? (
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
