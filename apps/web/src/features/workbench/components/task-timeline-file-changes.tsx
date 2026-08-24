import { FilePenLine, Files } from "lucide-react";
import { useState } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";

import {
  countFileChangeLines,
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
  const { additions, removals } = countFileChangeLines(change);

  return (
    <Button
      variant="ghost"
      aria-haspopup="dialog"
      aria-label={i18n.t("timeline.fileChange", {
        additions,
        name: fileName,
        ns: "conversation",
        operation: operationLabel,
        removals,
      })}
      className="flex min-h-9 w-full items-center gap-2 rounded-control bg-control px-2.5 text-left text-label text-foreground transition-colors hover:bg-control-hover"
      data-file-change={change.kind}
      onClick={() => {
        onOpen(change);
      }}
      type="button"
    >
      <FilePenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 text-muted-foreground">{operationLabel}</span>
      <span className="min-w-0 truncate font-medium">{fileName}</span>
      <span className="ml-auto shrink-0 text-diff-added">+{additions}</span>
      <span className="shrink-0 text-diff-removed">-{removals}</span>
    </Button>
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
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeFileChanges(changes);
  const visibleChanges = expanded ? summary.changes : summary.changes.slice(0, 3);
  const hiddenChangeCount = summary.changes.length - visibleChanges.length;

  return (
    <section
      aria-label={i18n.t("timeline.changedFiles", {
        count: summary.changes.length,
        ns: "conversation",
      })}
      className="mt-4 w-full overflow-hidden rounded-surface border border-separator-strong bg-raised shadow-control"
    >
      <header className="flex min-h-16 items-center gap-3 px-3 py-2.5 shadow-toolbar">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-control text-muted-foreground">
          <Files className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body-small font-semibold">
            {i18n.t("timeline.editedFiles", {
              count: summary.changes.length,
              ns: "conversation",
            })}
          </h3>
          <p className="mt-0.5 text-label text-muted-foreground">
            <span className="text-diff-added">+{summary.additions}</span>{" "}
            <span className="text-diff-removed">-{summary.removals}</span>
          </p>
        </div>
        <Button
          variant="ghost"
          aria-haspopup="dialog"
          className="h-8 rounded-control bg-control px-3 text-label font-semibold text-foreground transition-colors hover:bg-control-hover"
          onClick={() => {
            onReviewFileChanges(summary.changes);
          }}
          type="button"
        >
          {i18n.t("timeline.review", { ns: "conversation" })}
        </Button>
      </header>
      <div className="space-y-1 p-2">
        {visibleChanges.map((change) => (
          <FileChangeButton change={change} key={change.path} onOpen={onOpenFileDiff} />
        ))}
        {hiddenChangeCount > 0 ? (
          <Button
            variant="ghost"
            className="h-8 w-full rounded-control px-2.5 text-left text-label font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
            onClick={() => {
              setExpanded(true);
            }}
            type="button"
          >
            {i18n.t("timeline.moreFiles", {
              count: hiddenChangeCount,
              ns: "conversation",
            })}
          </Button>
        ) : null}
        {expanded && summary.changes.length > 3 ? (
          <Button
            variant="ghost"
            className="h-8 w-full rounded-control px-2.5 text-left text-label font-medium text-muted-foreground transition-colors hover:bg-control-hover hover:text-foreground"
            onClick={() => {
              setExpanded(false);
            }}
            type="button"
          >
            {i18n.t("timeline.collapseFiles", { ns: "conversation" })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
