import { lazy, Suspense, useState } from "react";

import type { AgentFileChange } from "../../diff/file-change.js";
import { FileDiffPanel } from "../../diff/file-diff-panel.js";
import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
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
  onClose,
}: Readonly<{
  document: Extract<InspectorDocument, { kind: "review" }>;
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
      />
    </Suspense>
  );
}

export function WorkbenchInspectorDocument({
  client,
  document,
  onClose,
  onOpenDiff,
  projectId,
  rootPath,
}: Readonly<{
  client: CodexlyWorkbenchClient;
  document: InspectorDocument;
  onClose: () => void;
  onOpenDiff: (change: AgentFileChange) => void;
  projectId: string;
  rootPath?: string;
}>) {
  if (document.kind === "diff") return <FileDiffPanel change={document.change} />;
  if (document.kind === "review") return <ReviewDocument document={document} onClose={onClose} />;
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
  const change = document.change;
  return (
    <ProjectSourcePanel
      client={client}
      {...(change === undefined
        ? {}
        : {
            onOpenDiff: () => {
              onOpenDiff(change);
            },
          })}
      previewKind={document.kind}
      projectId={document.projectId ?? projectId}
      reference={document.reference}
      {...((document.rootPath ?? rootPath) === undefined
        ? {}
        : { rootPath: document.rootPath ?? rootPath })}
    />
  );
}
