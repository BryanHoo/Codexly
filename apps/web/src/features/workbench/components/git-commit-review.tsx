import type { ProjectGitCommit } from "@code-agent/protocol";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { LoaderCircle, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { i18n, useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import { Dialog, DialogContent, DialogTitle } from "../../../shared/components/core/dialog.js";
import type { AgentFileChange } from "../../diff/file-change.js";
import { FileReviewWorkspace } from "../../diff/file-review-dialog.js";
import type { CodeAgentGitCommitReviewClient } from "../../projects/project-queries.js";
import {
  projectGitCommitFileDiffQueryOptions,
  projectGitCommitFilesInfiniteQueryOptions,
} from "../../projects/project-queries.js";

const PatchDiffViewer = lazy(() => import("../../diff/patch-diff-viewer.js"));

type CommitDiffContentProps = Readonly<{
  change: AgentFileChange;
  client: CodeAgentGitCommitReviewClient;
  projectId: string;
  repository?: string;
  rootPath: string;
  sha: string;
}>;

function CommitDiffContent({
  change,
  client,
  projectId,
  repository,
  rootPath,
  sha,
}: CommitDiffContentProps) {
  const query = useQuery(
    projectGitCommitFileDiffQueryOptions(
      projectId,
      rootPath,
      repository,
      sha,
      change.path,
      true,
      client,
    ),
  );

  if (query.isPending) {
    return (
      <div
        className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
        role="status"
      >
        {i18n.t("gitHistory.diffLoading", { ns: "conversation" })}
      </div>
    );
  }
  if (query.error !== null) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-body-small text-danger">
          {i18n.t("gitHistory.diffLoadError", { ns: "conversation" })}
        </p>
        <Button onClick={() => void query.refetch()} type="button" variant="outline">
          {i18n.t("gitHistory.retry", { ns: "conversation" })}
        </Button>
      </div>
    );
  }

  const loadedChange = { ...change, diff: query.data.diff };
  return (
    <div className="min-h-full min-w-max">
      {query.data.truncated ? (
        <p
          className="sticky left-0 top-0 z-10 border-b border-separator bg-warning px-3 py-2 text-caption text-warning-foreground"
          role="status"
        >
          {i18n.t("gitHistory.diffTruncated", { ns: "conversation" })}
        </p>
      ) : null}
      <Suspense
        fallback={
          <div
            className="grid min-h-48 place-items-center text-body-small text-muted-foreground"
            role="status"
          >
            {i18n.t("gitHistory.diffLoading", { ns: "conversation" })}
          </div>
        }
      >
        <PatchDiffViewer change={loadedChange} />
      </Suspense>
    </div>
  );
}

type GitCommitReviewProps = Readonly<{
  client: CodeAgentGitCommitReviewClient;
  commit: ProjectGitCommit;
  onClose: () => void;
  projectId: string;
  repository?: string;
  rootPath: string;
}>;

export function GitCommitReview({
  client,
  commit,
  onClose,
  projectId,
  repository,
  rootPath,
}: GitCommitReviewProps) {
  useTranslation("conversation");
  const [currentIndex, setCurrentIndex] = useState(0);
  const filesQuery = useInfiniteQuery(
    projectGitCommitFilesInfiniteQueryOptions(
      projectId,
      rootPath,
      repository,
      commit.sha,
      true,
      client,
    ),
  );
  const files = useMemo(
    () => filesQuery.data?.pages.flatMap((page) => page.files) ?? [],
    [filesQuery.data?.pages],
  );
  const changes = useMemo<readonly AgentFileChange[]>(
    () => files.map((file) => ({ ...file, diff: "" })),
    [files],
  );

  useEffect(() => {
    setCurrentIndex(0);
  }, [commit.sha]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent
        aria-labelledby="git-commit-review-dialog-title"
        className="h-[min(86dvh,58rem)] max-w-[78rem] overflow-hidden p-0"
      >
        <DialogTitle className="sr-only" id="git-commit-review-dialog-title">
          {commit.title}
        </DialogTitle>
        {filesQuery.isPending || filesQuery.error !== null || changes.length === 0 ? (
          <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-raised">
            <header className="flex min-h-toolbar min-w-0 items-center gap-2 px-3 shadow-toolbar sm:px-4">
              <h2 className="min-w-0 flex-1 truncate text-body-small font-semibold">
                {commit.title}
              </h2>
              <Button
                aria-label={i18n.t("diff.closeReview", { ns: "workbench" })}
                onClick={onClose}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </header>
            <div className="grid min-h-0 place-items-center px-5 text-center text-body-small">
              {filesQuery.isPending ? (
                <p className="text-muted-foreground" role="status">
                  {i18n.t("gitHistory.filesLoading", { ns: "conversation" })}
                </p>
              ) : filesQuery.error !== null ? (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-danger">
                    {i18n.t("gitHistory.filesLoadError", { ns: "conversation" })}
                  </p>
                  <Button onClick={() => void filesQuery.refetch()} type="button" variant="outline">
                    {i18n.t("gitHistory.retry", { ns: "conversation" })}
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {i18n.t("gitHistory.filesEmpty", { ns: "conversation" })}
                </p>
              )}
            </div>
          </section>
        ) : (
          <FileReviewWorkspace
            changes={changes}
            currentIndex={currentIndex}
            navigationFooter={
              filesQuery.hasNextPage ? (
                <div className="flex min-h-12 items-center justify-center px-2 py-2">
                  <Button
                    className="max-workbench:h-11"
                    disabled={filesQuery.isFetchingNextPage}
                    onClick={() => void filesQuery.fetchNextPage()}
                    type="button"
                    variant="outline"
                  >
                    {filesQuery.isFetchingNextPage ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                        data-icon="inline-start"
                      />
                    ) : null}
                    {filesQuery.isFetchingNextPage
                      ? i18n.t("gitHistory.loadingMoreFiles", { ns: "conversation" })
                      : i18n.t("gitHistory.loadMoreFiles", { ns: "conversation" })}
                  </Button>
                </div>
              ) : null
            }
            onClose={onClose}
            onCurrentIndexChange={setCurrentIndex}
            renderContent={(change) => (
              <CommitDiffContent
                change={change}
                client={client}
                projectId={projectId}
                rootPath={rootPath}
                {...(repository === undefined ? {} : { repository })}
                sha={commit.sha}
              />
            )}
            showStats={false}
            titleId="git-commit-review-file-title"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
