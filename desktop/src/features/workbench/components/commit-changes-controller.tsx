import type { CommitProjectChangesResponse, ProjectGitStatus } from "@/protocol/index.js";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentFileChange } from "../../diff/file-change.js";
import type { NativeWorkbenchClient } from "../../projects/project-queries.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import { recordInternalWarning } from "../../notifications/internal-diagnostics.js";
import {
  projectCommitChangesMutationOptions,
  projectCommitMessageMutationOptions,
  projectGitRepositoryStatusQueryOptions,
} from "../../projects/project-queries.js";
import { CommitChangesPanel, collectCommitRepositories } from "./commit-changes-panel.js";
import { useCommitStatusPages } from "../hooks/use-commit-status-pages.js";
import { loadProjectGitFileDiff } from "../project-git-file-diff.js";
import { useTranslation } from "../../../i18n/i18n.js";

type CommitChangesControllerProps = Readonly<{
  client: NativeWorkbenchClient;
  detailsError?: Error | null;
  detailsPending?: boolean;
  gitStatus: ProjectGitStatus;
  onOpenFileDiff: (change: AgentFileChange) => void;
  projectId: string;
  rootPath: string;
}>;

function getCommitSuccessMessageKey(result: CommitProjectChangesResponse): string | null {
  if (result.pushStatus === "pushed") {
    return "commit.commitAndPushSucceeded";
  }
  return result.pushStatus === "not_requested" ? "commit.commitSucceeded" : null;
}

export function CommitChangesController({
  client,
  detailsError = null,
  detailsPending = false,
  gitStatus,
  onOpenFileDiff,
  projectId,
  rootPath,
}: CommitChangesControllerProps) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const messageMutation = useMutation(
    projectCommitMessageMutationOptions(projectId, rootPath, client),
  );
  const commitMutation = useMutation({
    ...projectCommitChangesMutationOptions(projectId, rootPath, client),
    meta: { actionNotification: { successMessage: false } },
  });
  const repositories = useMemo(() => collectCommitRepositories(gitStatus), [gitStatus]);
  const [resultState, setResultState] = useState<{
    result: CommitProjectChangesResponse;
    snapshot: string;
  }>();
  const [loadingDiff, setLoadingDiff] = useState(false);
  const previewRequest = useRef(0);
  useEffect(() => () => { previewRequest.current++; }, [projectId, rootPath]);
  const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
  const effectiveRepository =
    selectedRepository !== null && repositories.includes(selectedRepository)
      ? selectedRepository
      : (repositories[0] ?? null);
  const repositoryStatusQuery = useQuery(
    projectGitRepositoryStatusQueryOptions(
      projectId,
      rootPath,
      effectiveRepository,
      gitStatus.repositoryMode === "children",
      client,
    ),
  );
  const initialGitStatus =
    gitStatus.repositoryMode === "root" ? gitStatus : (repositoryStatusQuery.data ?? gitStatus);
  const pages = useCommitStatusPages(client, projectId, rootPath, gitStatus.repositoryMode === "root" ? null : effectiveRepository, initialGitStatus);
  const activeGitStatus = pages.status;
  const result = resultState?.snapshot === activeGitStatus.snapshot ? resultState.result : null;
  const statusError = detailsError ?? repositoryStatusQuery.error ?? pages.error;

  useEffect(() => {
    if (statusError !== null) {
      recordInternalWarning("git_status_details_query_failed", statusError, { projectId });
    }
  }, [projectId, statusError]);

  return (
    <CommitChangesPanel
      error={statusError}
      gitStatus={activeGitStatus}
      isCommitting={commitMutation.isPending}
      isGenerating={messageMutation.isPending}
      isRepositoryLoading={detailsPending || repositoryStatusQuery.isFetching}
      onCommit={async (request) => {
        const submittedSnapshot = request.expectedSnapshot;
        const response = await commitMutation.mutateAsync(request);
        setResultState({ result: response, snapshot: submittedSnapshot });
        void queryClient.invalidateQueries({
          queryKey: ["projects", projectId, rootPath, "git-status"],
        });
        void queryClient.invalidateQueries({
          queryKey: ["projects", projectId, rootPath, "git-history"],
        });
        // 提交与收尾分别反馈，不能让已完成的提交看起来需要重试。
        if (response.indexSyncError !== null) {
          notifyActionError(new Error(t("commit.indexSyncFailed", { sha: response.commitSha.slice(0, 7) })));
        }
        const successMessageKey = getCommitSuccessMessageKey(response);
        if (successMessageKey !== null) {
          if (response.indexSyncError === null) notifyActionSuccess(t(successMessageKey));
          return;
        }
        notifyActionError(new Error(response.pushError ?? t("commit.commitCompletePushFailed")));
      }}
      onGenerateMessage={async (request) => {
        const response = await messageMutation.mutateAsync(request);
        return response.message;
      }}
      isDiffLoading={loadingDiff}
      isLoadingMore={pages.loading}
      onLoadMore={() => { void pages.loadMore(); }}
      onOpenFileDiff={(change) => {
        const request = ++previewRequest.current;
        setLoadingDiff(true);
        void loadProjectGitFileDiff(queryClient, client, projectId, rootPath, activeGitStatus, change,
          gitStatus.repositoryMode === "root" ? null : effectiveRepository)
          .then((loaded) => { if (request === previewRequest.current) onOpenFileDiff(loaded); })
          .catch((error: unknown) => { if (request === previewRequest.current) notifyActionError(error); })
          .finally(() => { if (request === previewRequest.current) setLoadingDiff(false); });
      }}
      onSelectRepository={(repository) => {
        setResultState(undefined);
        messageMutation.reset();
        commitMutation.reset();
        previewRequest.current++;
        setLoadingDiff(false);
        setSelectedRepository(repository);
      }}
      repositories={repositories}
      result={result}
      selectedRepository={effectiveRepository}
    />
  );
}
