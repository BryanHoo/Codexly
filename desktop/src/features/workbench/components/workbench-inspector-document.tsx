import { FileDiff, LoaderCircle } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import type { AgentFileChange } from "../../diff/file-change.js";
import { AsyncFileDiff } from "../../diff/async-file-diff.js";
import { FileDiffPanel } from "../../diff/file-diff-panel.js";
import type { NativeWorkbenchClient } from "../../projects/project-queries.js";
import { notifyActionError } from "../../notifications/action-notifications.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { ProjectSourcePanel } from "./project-source-panel.js";
import type { InspectorDocument } from "./workbench-inspector-documents.js";

const LazyFileReviewWorkspace = lazy(async () => {
  const module = await import("../../diff/file-review-dialog.js");
  return { default: module.FileReviewWorkspace };
});
const LazyGitCommitReview = lazy(async () => {
  const module = await import("./git-commit-review.js");
  return { default: module.GitCommitReview };
});

function ReviewDocument({
  document,
  loadDiff,
  onClose,
}: Readonly<{
  document: Extract<InspectorDocument, { kind: "review" }>;
  loadDiff?: (change: AgentFileChange) => Promise<AgentFileChange>;
  onClose: () => void;
}>) {
  const [currentIndex, setCurrentIndex] = useState(0);
  return (
    <Suspense fallback={null}>
      <LazyFileReviewWorkspace
        changes={document.changes}
        compact
        currentIndex={currentIndex}
        onClose={onClose}
        onCurrentIndexChange={setCurrentIndex}
        titleId={`review-${document.id}`}
        {...(loadDiff === undefined
          ? {}
          : {
              showStats: document.changes.every(
                (change) => change.statsAvailable || change.diff !== "",
              ),
              renderContent: (change: AgentFileChange) => (
                <AsyncFileDiff change={change} loadDiff={loadDiff} />
              ),
            })}
      />
    </Suspense>
  );
}

function SourceDocument({
  client,
  document,
  loadDiff,
  onOpenDiff,
  projectId,
  rootPath,
  taskId,
}: Readonly<{
  client: NativeWorkbenchClient;
  document: Extract<InspectorDocument, { kind: "source" | "image" }>;
  loadDiff?: (change: AgentFileChange) => Promise<AgentFileChange>;
  onOpenDiff: (change: AgentFileChange) => void;
  projectId: string;
  rootPath?: string;
  taskId?: string;
}>) {
  const { t } = useTranslation("workbench");
  const [pending, setPending] = useState(false);
  const change = document.change;
  const headerActions =
    change === undefined || loadDiff === undefined ? null : (
      <Button
        aria-label={t("projectDialog.showDiff")}
        disabled={pending}
        onClick={() => {
          setPending(true);
          void loadDiff(change)
            .then(onOpenDiff)
            .catch((error: unknown) =>
              notifyActionError(
                error instanceof Error ? error : new Error("Git diff is unavailable"),
              ),
            )
            .finally(() => setPending(false));
        }}
        size="icon-sm"
        title={t("projectDialog.showDiff")}
        type="button"
        variant="ghost"
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <FileDiff className="size-3.5" />
        )}
      </Button>
    );
  return (
    <ProjectSourcePanel
      client={client}
      headerActions={headerActions}
      previewKind={document.kind}
      projectId={document.projectId ?? projectId}
      reference={document.reference}
      {...((document.rootPath ?? rootPath) === undefined
        ? {}
        : { rootPath: document.rootPath ?? rootPath })}
      {...(taskId === undefined || document.projectId !== undefined ? {} : { taskId })}
    />
  );
}

export function WorkbenchInspectorDocument({
  client,
  document,
  loadDiff,
  onClose,
  onOpenDiff,
  projectId,
  rootPath,
  taskId,
}: Readonly<{
  client: NativeWorkbenchClient;
  document: InspectorDocument;
  loadDiff?: (change: AgentFileChange) => Promise<AgentFileChange>;
  onClose: () => void;
  onOpenDiff: (change: AgentFileChange) => void;
  projectId: string;
  rootPath?: string;
  taskId?: string;
}>) {
  if (document.kind === "diff") return <FileDiffPanel change={document.change} />;
  if (document.kind === "review")
    return (
      <ReviewDocument
        document={document}
        {...(loadDiff === undefined ? {} : { loadDiff })}
        onClose={onClose}
      />
    );
  if (document.kind === "commit")
    return (
      <Suspense fallback={null}>
        <LazyGitCommitReview
          client={client}
          commit={document.commit}
          onClose={onClose}
          projectId={projectId}
          rootPath={rootPath ?? ""}
          {...(document.repository === undefined ? {} : { repository: document.repository })}
        />
      </Suspense>
    );
  return (
    <SourceDocument
      client={client}
      document={document}
      {...(loadDiff === undefined ? {} : { loadDiff })}
      onOpenDiff={onOpenDiff}
      projectId={projectId}
      {...(rootPath === undefined ? {} : { rootPath })}
      {...(taskId === undefined ? {} : { taskId })}
    />
  );
}
