import { isEmptyFileUpdate } from "@codexly/frontend-core/file-change-visibility";
import type { AgentItem, AgentTurn } from "@codexly/protocol";
import { formatDisplayPath } from "@codexly/frontend-core/display-path";
import { Task, TaskContent, TaskItem, TaskTrigger } from "../../../shared/components/agent/task.js";
import { isVisibleProjectPath } from "@codexly/frontend-core/project-file-visibility";
import { useConversationDisplayPreference } from "@codexly/ui/core/conversation-display-preferences";
import { conversationDisplayPreferences } from "../../settings/conversation-display-preferences.js";
import { lazy, Suspense, memo } from "react";
import { buildProjectFileDownloadUrl } from "@codexly/client";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { ChangedFilesCard as SharedChangedFilesCard } from "@codexly/ui/agent/changed-files-card";
import { FileChange } from "@codexly/ui/agent/file-change";
import { useCallback, useMemo, type ReactNode } from "react";

import { i18n } from "../../../i18n/i18n.js";
import {
  MessageFileDownloadProvider,
  useMessageFileDownload,
  type MessageFileDownload,
} from "../../../shared/components/agent/message-file-download.js";
import type { MessageFileReference } from "../../../shared/components/agent/message.js";
import { useIsLanAccess } from "../../access/access-context.js";

import {
  countFileChangeLines,
  getFileName,
  summarizeFileChanges,
  type AgentFileChange,
} from "../../diff/file-change.js";
import { LanDownloadContextMenu } from "./lan-download-context-menu.js";

type TimelineFileDownloadContext = Readonly<{
  projectId: string;
  rootPath?: string;
}>;

function resolveTimelineFileDownload(
  context: TimelineFileDownloadContext,
  reference: MessageFileReference,
): MessageFileDownload | null {
  if (reference.path.length === 0) return null;
  return {
    name: reference.path.split(/[\\/]/u).at(-1) ?? reference.path,
    url: buildProjectFileDownloadUrl("", context.projectId, reference.path, context.rootPath),
  };
}

export function TimelineFileDownloadProvider({
  children,
  projectId,
  rootPath,
}: Readonly<{
  children: ReactNode;
  projectId: string;
  rootPath?: string;
}>) {
  const isLanAccess = useIsLanAccess();
  const context = useMemo<TimelineFileDownloadContext | null>(
    () =>
      isLanAccess && (projectId === TEMPORARY_TASK_SCOPE_ID || rootPath !== undefined)
        ? { projectId, ...(rootPath === undefined ? {} : { rootPath }) }
        : null,
    [isLanAccess, projectId, rootPath],
  );
  const resolveDownload = useCallback(
    (reference: MessageFileReference) =>
      context === null ? null : resolveTimelineFileDownload(context, reference),
    [context],
  );
  return (
    <MessageFileDownloadProvider resolveDownload={context === null ? null : resolveDownload}>
      {children}
    </MessageFileDownloadProvider>
  );
}

export function FileChangeButton({
  change,
  onOpen,
}: Readonly<{ change: AgentFileChange; onOpen: (change: AgentFileChange) => void }>) {
  const fileName = getFileName(change.path);
  const download = useMessageFileDownload({ lineNumber: null, path: change.path });
  const operationLabel = i18n.t(`timeline.fileOperation.${change.kind}`, {
    ns: "conversation",
  });
  const { additions, removals } = countFileChangeLines(change);

  const button = (
    <FileChange
      additions={additions}
      aria-label={i18n.t("timeline.fileChange", {
        additions,
        name: fileName,
        ns: "conversation",
        operation: operationLabel,
        removals,
      })}
      kind={change.kind}
      name={fileName}
      onClick={() => {
        onOpen(change);
      }}
      operation={operationLabel}
      removals={removals}
      title={change.path}
    />
  );
  if (download === null || change.kind === "delete") return button;

  return (
    <LanDownloadContextMenu enabled name={download.name} url={download.url}>
      {button}
    </LanDownloadContextMenu>
  );
}

export function ChangedFilesCard({
  changes,
  onOpenFileDiff,
  onReviewFileChanges,
}: Readonly<{
  changes: readonly AgentFileChange[];
  onOpenFileDiff: (change: AgentFileChange) => void;
  onReviewFileChanges: (changes: readonly AgentFileChange[]) => void;
}>) {
  const summary = summarizeFileChanges(changes);
  if (summary.changes.length === 0) return null;

  return (
    <SharedChangedFilesCard
      additions={summary.additions}
      changes={summary.changes}
      collapseLabel={i18n.t("timeline.collapseFiles", { ns: "conversation" })}
      label={i18n.t("timeline.changedFiles", {
        count: summary.changes.length,
        ns: "conversation",
      })}
      moreLabel={(count) => i18n.t("timeline.moreFiles", { count, ns: "conversation" })}
      onReview={() => {
        onReviewFileChanges(summary.changes);
      }}
      removals={summary.removals}
      renderChange={(change) => (
        <FileChangeButton change={change} key={change.path} onOpen={onOpenFileDiff} />
      )}
      reviewLabel={i18n.t("timeline.review", { ns: "conversation" })}
      title={i18n.t("timeline.editedFiles", {
        count: summary.changes.length,
        ns: "conversation",
      })}
    />
  );
}

// 独立展示关闭时不加载卡片模块，避免把新增 UI 计入工作区和编辑器的静态依赖。
const FileDiffCard = lazy(() =>
  import("@codexly/ui/agent/file-diff-card").then((module) => ({ default: module.FileDiffCard })),
);
const InlinePatchPreview = lazy(() => import("../../diff/patch-diff-viewer.js"));

const TimelineFileDiff = memo(function TimelineFileDiff({
  change,
  status,
  onOpen,
}: Readonly<{
  change: AgentFileChange;
  status: string;
  onOpen: (change: AgentFileChange) => void;
}>) {
  const stats = countFileChangeLines(change);
  const unavailable = i18n.t("diff.previewUnavailable", { ns: "workbench" });
  return (
    <Suspense fallback={null}>
      <FileDiffCard
        path={change.path}
        additions={stats.additions}
        removals={stats.removals}
        status={status}
        statusLabel={i18n.t(`timeline.fileDiffStatus.${status}`, { ns: "conversation" })}
        openLabel={i18n.t("timeline.fileDiffOpen", { ns: "conversation" })}
        onOpen={() => {
          onOpen(change);
        }}
      >
        <Suspense
          fallback={
            <div className="min-h-12 px-3 py-2 text-body-small text-muted-foreground" role="status">
              {i18n.t("timeline.fileDiffLoading", { ns: "conversation" })}
            </div>
          }
        >
          {change.diff.trim() ? (
            <InlinePatchPreview change={change} />
          ) : (
            <div className="px-3 py-2 text-body-small text-muted-foreground">{unavailable}</div>
          )}
        </Suspense>
      </FileDiffCard>
    </Suspense>
  );
});

export function TimelineFileChangePresentation({
  item,
  turnStatus,
  onOpen,
  children,
}: Readonly<{
  item: { status: string; changes: readonly AgentFileChange[] };
  turnStatus: string;
  onOpen: (change: AgentFileChange) => void;
  children: ReactNode;
}>) {
  const independent = useConversationDisplayPreference(
    conversationDisplayPreferences,
    "independentFileDiffs",
  );
  // 只过滤已完成的空操作，等待、运行及失败记录继续保留真实状态。
  if (
    item.status === "completed" &&
    item.changes.length > 0 &&
    item.changes.every(isEmptyFileUpdate)
  )
    return null;
  if (!independent) return children;
  // 中断时没有完成事件的文件修改不能继续标为运行；已应用修改仍保留真实状态。
  const status =
    turnStatus !== "running" && (item.status === "pending" || item.status === "running")
      ? "interrupted"
      : item.status;
  return (
    <div className="min-w-0 space-y-2" data-independent-file-diffs="">
      {item.changes.length === 0 ? (
        <div className="text-body-small text-muted-foreground" role="status">
          {i18n.t(`timeline.fileDiffStatus.${status}`, { ns: "conversation" })}
        </div>
      ) : null}
      {item.changes
        .filter(
          (change) =>
            isVisibleProjectPath(change.path) &&
            (item.status !== "completed" || !isEmptyFileUpdate(change)),
        )
        .map((change) => (
          <TimelineFileDiff key={change.path} change={change} status={status} onOpen={onOpen} />
        ))}
    </div>
  );
}

export function LegacyTimelineFileChange({
  item,
  onOpenFileDiff,
  turnStatus,
}: Readonly<{
  item: Extract<AgentItem, { type: "file_change" }>;
  onOpenFileDiff: (change: AgentFileChange) => void;
  turnStatus: AgentTurn["status"];
}>) {
  if (item.status === "completed") {
    // 回合运行期间展示可打开的修改；终态文件汇总由回复末尾统一呈现。
    return turnStatus === "running" ? (
      <div className="space-y-1">
        {item.changes.map((change) => (
          <FileChangeButton change={change} key={change.path} onOpen={onOpenFileDiff} />
        ))}
      </div>
    ) : null;
  }
  if (item.status !== "pending" && item.status !== "running") return null;
  return (
    <Task collapsible={item.changes.length > 0} status="in_progress">
      <TaskTrigger
        title={i18n.t("timeline.editingFiles", {
          count: item.changes.length,
          ns: "conversation",
        })}
      />
      {item.changes.length === 0 ? null : (
        <TaskContent>
          {item.changes.map((change) => (
            <TaskItem className="break-all font-mono" key={change.path}>
              {formatDisplayPath(change.path)}
            </TaskItem>
          ))}
        </TaskContent>
      )}
    </Task>
  );
}
