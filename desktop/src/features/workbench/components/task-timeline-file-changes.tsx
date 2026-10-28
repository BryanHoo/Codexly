import { ChangedFilesCard as SharedChangedFilesCard } from "@codexly/ui/agent/changed-files-card";
import { FileChange } from "@codexly/ui/agent/file-change";

import { i18n } from "../../../i18n/i18n.js";

import {
  getFileChangeStats,
  getFileName,
  summarizeFileChanges,
  type AgentFileChange,
} from "../../diff/file-change.js";

export function FileChangeButton({
  change,
  onOpen,
}: Readonly<{ change: AgentFileChange; onOpen: (change: AgentFileChange) => void }>) {
  const fileName = getFileName(change.path);
  const operationLabel = i18n.t(`timeline.fileOperation.${change.kind}`, {
    ns: "conversation",
  });
  const { additions, removals } = getFileChangeStats(change);

  return (
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
