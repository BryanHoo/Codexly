import {
  ChevronDown,
  ChevronUp,
  FileCode2,
  Files,
  PanelRightClose,
  PanelRightOpen,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../shared/components/core/dialog.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../shared/components/core/tooltip.js";
import { useTranslation } from "../../i18n/i18n.js";
import type { AgentFileChange } from "./file-change.js";
import { getFileName } from "./file-change.js";
import { buildReviewFileTree, ReviewFileTreeNavigation } from "./file-review-tree.js";

const PatchDiffViewer = lazy(() => import("./patch-diff-viewer.js"));
const reviewNavigationOverlayQuery = "(max-width: 760px)";

function shouldOpenReviewNavigation() {
  return typeof window === "undefined" || !window.matchMedia(reviewNavigationOverlayQuery).matches;
}

export function getReviewNavigationDirection(key: string): "next" | "previous" | null {
  // 左右方向键保留给宽 Diff 的原生横向滚动，只用上下方向键切换文件。
  if (key === "ArrowUp") {
    return "previous";
  }
  if (key === "ArrowDown") {
    return "next";
  }
  return null;
}

export function resolveReviewIndex(
  currentIndex: number,
  direction: "next" | "previous",
  changeCount: number,
): number {
  if (changeCount <= 0) {
    return 0;
  }
  const offset = direction === "next" ? 1 : -1;
  return Math.min(Math.max(currentIndex + offset, 0), changeCount - 1);
}

type FileReviewWorkspaceProps = Readonly<{
  changes: readonly AgentFileChange[];
  currentIndex: number;
  navigationFooter?: ReactNode;
  onClose: () => void;
  onCurrentIndexChange: (index: number) => void;
  renderContent?: (change: AgentFileChange) => ReactNode;
  showStats?: boolean;
  titleId: string;
}>;

export function FileReviewWorkspace({
  changes,
  currentIndex,
  navigationFooter,
  onClose,
  onCurrentIndexChange,
  renderContent,
  showStats = true,
  titleId,
}: FileReviewWorkspaceProps) {
  const { t } = useTranslation("workbench");
  const reviewContentRef = useRef<HTMLElement>(null);
  const [navigationOpen, setNavigationOpen] = useState(shouldOpenReviewNavigation);
  const fileTree = useMemo(() => buildReviewFileTree(changes), [changes]);
  const fileIndexByPath = useMemo(
    () =>
      new Map(
        changes.map((change, changeIndex) => [change.path.replaceAll("\\", "/"), changeIndex]),
      ),
    [changes],
  );

  useEffect(() => {
    // 初始状态与工作台移动断点一致：桌面直接展示导航，移动端优先保留 Diff 宽度。
    setNavigationOpen(shouldOpenReviewNavigation());
  }, [changes]);

  useEffect(() => {
    // 切换后原焦点按钮可能变为 disabled；窗口级监听保证上下方向键不因焦点丢失而中断。
    const handleReviewKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const direction = getReviewNavigationDirection(event.key);
      if (direction !== null) {
        event.preventDefault();
        onCurrentIndexChange(resolveReviewIndex(currentIndex, direction, changes.length));
      }
    };
    window.addEventListener("keydown", handleReviewKeyDown);
    return () => {
      window.removeEventListener("keydown", handleReviewKeyDown);
    };
  }, [changes.length, currentIndex, onCurrentIndexChange]);

  useLayoutEffect(() => {
    // 左侧容器会跨文件复用，切换后必须主动清除上一个 Diff 的纵向滚动位置。
    if (reviewContentRef.current !== null) {
      reviewContentRef.current.scrollTop = 0;
    }
  }, [currentIndex]);

  if (changes.length === 0) {
    return null;
  }

  const firstChange = changes[0];
  if (firstChange === undefined) {
    return null;
  }
  const change = changes[currentIndex] ?? firstChange;
  const selectedPath = change.path.replaceAll("\\", "/");
  const fileName = getFileName(change.path);
  const navigationLabel = t(
    navigationOpen ? "diff.collapseChangedFilesNavigation" : "diff.expandChangedFilesNavigation",
  );
  const navigate = (direction: "next" | "previous") => {
    onCurrentIndexChange(resolveReviewIndex(currentIndex, direction, changes.length));
  };

  return (
    <section className="grid h-full min-h-0 w-full min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
      <header className="flex min-h-toolbar min-w-0 items-center gap-2 px-3 shadow-toolbar sm:px-4">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-body-small font-semibold" id={titleId} title={change.path}>
            {fileName}
          </h2>
          <p className="truncate text-caption text-muted-foreground" title={change.path}>
            {change.path}
          </p>
        </div>
        <span className="shrink-0 text-label text-muted-foreground">
          {currentIndex + 1} / {changes.length}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("diff.previousFile")}
                disabled={currentIndex === 0}
                onClick={() => {
                  navigate("previous");
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ChevronUp className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("diff.previousFile")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("diff.nextFile")}
                disabled={currentIndex === changes.length - 1}
                onClick={() => {
                  navigate("next");
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("diff.nextFile")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-controls="file-review-navigation"
                aria-expanded={navigationOpen}
                aria-label={navigationLabel}
                onClick={() => {
                  setNavigationOpen((open) => !open);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                {navigationOpen ? (
                  <PanelRightClose className="size-3.5" aria-hidden="true" />
                ) : (
                  <PanelRightOpen className="size-3.5" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{navigationLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t("diff.closeReview")}
                onClick={onClose}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("diff.closeReview")}</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div
        className={`relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] bg-content ${navigationOpen ? "workbench:grid-cols-[minmax(0,1fr)_minmax(12rem,26%)]" : ""}`}
      >
        <section
          aria-label={t("diff.reviewContent")}
          className="min-h-0 min-w-0 overflow-auto"
          ref={reviewContentRef}
        >
          {renderContent === undefined ? (
            <Suspense
              fallback={
                <div
                  className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
                  role="status"
                >
                  {t("diff.loading")}
                </div>
              }
            >
              <PatchDiffViewer change={change} />
            </Suspense>
          ) : (
            renderContent(change)
          )}
        </section>
        <aside
          aria-label={t("diff.changedFilesNavigation")}
          className="absolute inset-y-0 right-0 z-10 grid min-h-0 w-[min(16rem,82%)] grid-rows-[auto_minmax(0,1fr)] border-l border-separator bg-panel shadow-panel workbench:static workbench:z-auto workbench:w-auto workbench:shadow-none"
          hidden={!navigationOpen}
          id="file-review-navigation"
        >
          <div className="flex min-h-toolbar items-center gap-2 border-b border-separator px-3">
            <Files aria-hidden="true" className="size-3.5 text-muted-foreground" />
            <h3 className="min-w-0 flex-1 truncate text-label font-semibold">
              {t("diff.changedFiles")}
            </h3>
            <span className="text-meta text-muted-foreground">{changes.length}</span>
          </div>
          <div className="min-h-0 overflow-y-auto px-2 py-2">
            <ReviewFileTreeNavigation
              nodes={fileTree}
              onSelect={(path) => {
                const nextIndex = fileIndexByPath.get(path);
                if (nextIndex !== undefined) {
                  onCurrentIndexChange(nextIndex);
                }
              }}
              selectedPath={selectedPath}
              showStats={showStats}
            />
            {navigationFooter}
          </div>
        </aside>
      </div>
    </section>
  );
}

type FileReviewDialogProps = Readonly<{
  changes: readonly AgentFileChange[] | null;
  onClose: () => void;
}>;

export function FileReviewDialog({ changes, onClose }: FileReviewDialogProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (changes !== null) {
      setCurrentIndex(0);
    }
  }, [changes]);

  if (changes === null || changes.length === 0) {
    return null;
  }

  const titleId = "file-review-dialog-title";
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby={titleId}
        className="h-[min(86dvh,58rem)] max-w-[78rem] overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{getFileName(changes[0]?.path ?? "")}</DialogTitle>
        <FileReviewWorkspace
          changes={changes}
          currentIndex={currentIndex}
          onClose={onClose}
          onCurrentIndexChange={setCurrentIndex}
          titleId={titleId}
        />
      </DialogContent>
    </Dialog>
  );
}
