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
