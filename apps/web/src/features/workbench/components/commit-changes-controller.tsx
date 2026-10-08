import type {
  CommitProjectChangesResponse,
  ProjectGitHistoryPage,
  ProjectGitStatus,
} from "@codexly/protocol";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import {
  projectCommitChangesMutationOptions,
  projectCommitMessageMutationOptions,
} from "../../projects/project-queries.js";
import { CommitChangesPanel } from "./commit-changes-panel.js";
import { useTranslation } from "../../../i18n/i18n.js";

type CommitChangesControllerProps = Readonly<{
  client: CodexlyWorkbenchClient;
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

export function cacheCommittedGitStatus(
  queryClient: QueryClient,
  projectId: string,
  rootPath: string,
  repository: string | undefined,
  status: ProjectGitStatus,
  history: ProjectGitHistoryPage,
): void {
  const queryKey =
    repository === undefined
      ? (["projects", projectId, rootPath, "git-status"] as const)
      : (["projects", projectId, rootPath, "git-status", repository] as const);
  queryClient.setQueryData(queryKey, status);
  queryClient.setQueryData(["projects", projectId, rootPath, "git-history", repository ?? null], {
    pageParams: [undefined],
    pages: [history],
  });
}

export function CommitChangesController({
  client,
  detailsError = null,
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
  const [resultState, setResultState] = useState<{
    result: CommitProjectChangesResponse;
    snapshot: string;
  }>();
  const activeGitStatus = gitStatus;
  const result = resultState?.snapshot === activeGitStatus.snapshot ? resultState.result : null;

  return (
    <CommitChangesPanel
      error={detailsError}
      gitStatus={activeGitStatus}
      isCommitting={commitMutation.isPending}
      isGenerating={messageMutation.isPending}
      onCommit={async (request) => {
        const response = await commitMutation.mutateAsync(request);
        // 返回的状态已包含提交后的快照，结果应随新快照保留，直到下一次工作区变化。
        setResultState({ result: response, snapshot: response.status.snapshot });
        cacheCommittedGitStatus(
          queryClient,
          projectId,
          rootPath,
          request.repository,
          response.status,
          response.history,
        );
        const successMessageKey = getCommitSuccessMessageKey(response);
        if (successMessageKey !== null) {
          notifyActionSuccess(t(successMessageKey));
          return;
        }
        notifyActionError(new Error(response.pushError ?? t("commit.commitCompletePushFailed")));
      }}
      onGenerateMessage={async (request) => {
        const response = await messageMutation.mutateAsync(request);
        return response.message;
      }}
      onOpenFileDiff={onOpenFileDiff}
      result={result}
    />
  );
}
