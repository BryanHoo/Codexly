import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import {
  getFiletypeFromFileName,
  parsePatchFiles,
  preloadHighlighter,
  setCustomExtension,
  type FileDiffMetadata,
} from "@pierre/diffs";
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import type { ReactNode, WheelEvent } from "react";
import { Component, useEffect, useMemo, useState } from "react";

const diffOptions = {
  diffIndicators: "bars",
  diffStyle: "unified",
  disableFileHeader: true,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word-alt",
  overflow: "scroll",
  theme: { dark: "github-dark", light: "github-light" },
  themeType: "system",
  unsafeCSS: `
    pre { font-family: var(--ui-font-family-mono); font-size: var(--ui-font-size-body-small); }
  `,
} satisfies NonNullable<FileDiffProps<undefined>["options"]>;

export function configureDiffLanguages(
  byExtension: Readonly<Record<string, string>>,
  byFileName: Readonly<Record<string, string>>,
) {
  for (const [extension, language] of Object.entries(byExtension)) {
    setCustomExtension(extension, language);
  }
  for (const [fileName, language] of Object.entries(byFileName)) {
    setCustomExtension(fileName, language);
  }
  setCustomExtension("Makefile", "makefile");
}

function findDiffHorizontalScroller(event: WheelEvent<HTMLDivElement>): HTMLElement | null {
  const pathScroller = event.nativeEvent
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        target instanceof HTMLElement && target.hasAttribute("data-code"),
    );
  if (pathScroller !== undefined) {
    return pathScroller;
  }

  const renderer = event.currentTarget.querySelector<HTMLElement>(".file-diff-renderer");
  return renderer?.shadowRoot?.querySelector<HTMLElement>("[data-code]") ?? null;
}

function handleDiffWheel(event: WheelEvent<HTMLDivElement>) {
  // 触控板直接提供 deltaX；普通鼠标使用 Shift + Wheel 进行横向移动。
  const delta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
  if (delta === 0) {
    return;
  }

  const scroller = findDiffHorizontalScroller(event);
  if (scroller === null) {
    return;
  }
  scroller.scrollLeft += delta;
}

type PatchDiffViewerProps = Readonly<{
  path: string;
  patch: string;
  preloadLanguage?: boolean;
  unavailableLabel?: string;
}>;

type ParsedDiffProps = Readonly<{ fileDiff: FileDiffMetadata }>;

function DiffContent({ fileDiff }: ParsedDiffProps) {
  return (
    <div className="min-w-0" onWheel={handleDiffWheel}>
      <FileDiff
        className="file-diff-renderer"
        disableWorkerPool
        options={diffOptions}
        fileDiff={fileDiff}
      />
    </div>
  );
}

// 错误只影响当前预览；解析结果变化时清除失败状态，切换到正常文件即可恢复。
class DiffPreviewBoundary extends Component<
  Readonly<{ children: ReactNode; fallback: ReactNode; fileDiff: FileDiffMetadata }>,
  { failed: boolean; fileDiff: FileDiffMetadata }
> {
  override state = { failed: false, fileDiff: this.props.fileDiff };
  static getDerivedStateFromProps(
    props: { fileDiff: FileDiffMetadata },
    state: { fileDiff: FileDiffMetadata },
  ) {
    return props.fileDiff === state.fileDiff ? null : { failed: false, fileDiff: props.fileDiff };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function parsePreviewPatch(patch: string): FileDiffMetadata | undefined {
  // 二进制说明和空补丁没有文本块，不能交给只接受单文件补丁的渲染入口。
  if (patch.trim().length === 0 || /^(?:Binary files .* differ|GIT binary patch)\r?$/mu.test(patch))
    return undefined;
  try {
    const patches = parsePatchFiles(patch, undefined, true);
    const file =
      patches.length === 1 && patches[0]?.files.length === 1 ? patches[0].files[0] : undefined;
    return file !== undefined && file.hunks.length > 0 ? file : undefined;
  } catch {
    // Provider 返回的截断或异常补丁降级为局部提示，不向页面路由抛出解析错误。
    return undefined;
  }
}

function PreloadedDiff({ path, fileDiff }: ParsedDiffProps & Readonly<{ path: string }>) {
  const language = getFiletypeFromFileName(path);
  const [readyLanguage, setReadyLanguage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Pierre 首次挂载时不会重放异步高亮结果，预加载当前语言可避免首个 Diff 空白。
    void preloadHighlighter({
      langs: [language],
      themes: ["github-dark", "github-light"],
    })
      .catch(() => {
        // 高亮不可用时仍允许渲染文本差异，并消费 Promise 拒绝，避免未处理异常。
      })
      .finally(() => {
        if (active) setReadyLanguage(language);
      });
    return () => {
      active = false;
    };
  }, [language]);

  if (readyLanguage !== language) {
    return <div className="min-h-24" role="status" />;
  }

  return <DiffContent fileDiff={fileDiff} />;
}

export function PatchDiffViewer({
  path,
  patch,
  preloadLanguage = false,
  unavailableLabel = path,
}: PatchDiffViewerProps) {
  // 每次正文变化仅解析一次，直接传递解析结果，避免 PatchDiff 内部重复扫描全文。
  const fileDiff = useMemo(() => parsePreviewPatch(patch), [patch]);
  const fallback = (
    <div
      className="grid min-h-24 place-items-center text-body-small text-muted-foreground"
      role="status"
    >
      {formatDisplayPath(unavailableLabel)}
    </div>
  );
  if (fileDiff === undefined) return fallback;
  return (
    <DiffPreviewBoundary fileDiff={fileDiff} fallback={fallback}>
      {preloadLanguage ? (
        <PreloadedDiff path={path} fileDiff={fileDiff} />
      ) : (
        <DiffContent fileDiff={fileDiff} />
      )}
    </DiffPreviewBoundary>
  );
}
