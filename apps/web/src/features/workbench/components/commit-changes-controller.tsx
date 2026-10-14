import { classifyGitFailure, type GitFailureKind } from "@codexly/frontend-core/git-recovery";
import type { PushProjectCommitsRequest } from "@codexly/protocol";
import {
  projectPushMutationOptions,
  shouldClearGitFailureAfterInspect,
  projectGitRemoteQueryOptions,
  projectGitRemoteMutationCallbacks,
} from "@codexly/frontend-core/project-git-push";
import type {
  CommitProjectChangesResponse,
  PushProjectCommitsResponse,
  ProjectGitHistoryPage,
  ProjectGitStatus,
} from "@codexly/protocol";
import {
  useMutation,
  useQuery,
  useIsMutating,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import type { AgentFileChange } from "../../diff/file-change.js";
import type { CodexlyWorkbenchClient } from "../../projects/project-queries.js";
import { notifyActionSuccess } from "../../notifications/action-notifications.js";
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
  onOpenHistory?: (() => void) | undefined;
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
  onOpenHistory,
  projectId,
  rootPath,
}: CommitChangesControllerProps) {
  const { t } = useTranslation("workbench");
  const queryClient = useQueryClient();
  const messageMutation = useMutation({
    ...projectCommitMessageMutationOptions(projectId, rootPath, client),
    meta: { actionNotification: false },
  });
  const commitMutation = useMutation({
    ...projectCommitChangesMutationOptions(projectId, rootPath, client),
    ...projectGitRemoteMutationCallbacks(projectId, rootPath, queryClient),
    meta: { actionNotification: false },
  });
  const pushMutation = useMutation(projectPushMutationOptions(projectId, rootPath, client));
  const [pushState, setPushState] = useState<{
    result: PushProjectCommitsResponse;
    snapshot: string;
    scope: string;
  }>();
  const [resultState, setResultState] = useState<{
    result: CommitProjectChangesResponse;
    snapshot: string;
    scope: string;
  }>();
  const activeGitStatus = gitStatus;
  const scope = JSON.stringify([projectId, rootPath, activeGitStatus.branch]);
  const result = resultState?.scope === scope ? resultState.result : null;
  // 同仓库任意窗口的 Git 写操作尚未完成时，暂停自动检查，避免把暂态读失败留在顶部。
  const writing =
    useIsMutating({
      predicate: (mutation) =>
        mutation.options.scope?.id === `project-git-mutation:${projectId}:${rootPath}`,
    }) > 0;
  const remoteOptions = projectGitRemoteQueryOptions(
    projectId,
    rootPath,
    activeGitStatus.branch,
    activeGitStatus.snapshot,
    client,
    writing,
  );
  const remoteQuery = useQuery({
    ...remoteOptions,
    enabled: activeGitStatus.repositoryMode === "root" && remoteOptions.enabled,
  });
  const operateRemote = async (
    request: Omit<PushProjectCommitsRequest, "expectedSnapshot">,
    failureKind?: GitFailureKind,
  ) => {
    const snapshot = activeGitStatus.snapshot;
    let response: PushProjectCommitsResponse;
    try {
      response = await pushMutation.mutateAsync({
        ...request,
        expectedSnapshot: snapshot,
        ...(["push", "publish", "fetch"].includes(request.action ?? "") && activeGitStatus.branch
          ? { expectedBranch: activeGitStatus.branch }
          : {}),
      });
    } catch (error) {
      setPushState({
        result: {
          branch: activeGitStatus.branch,
          pushStatus: "failed",
          pushError: error instanceof Error ? error.message : String(error),
        },
        snapshot,
        scope,
      });
      void queryClient.invalidateQueries({ queryKey: remoteOptions.queryKey });
      throw error;
    }
    if (response.remoteState) queryClient.setQueryData(remoteOptions.queryKey, response);
    // 刷新已核对的状态变化后恢复正常操作；本地检查不能抹去仍未验证的连接失败。
    if (
      request.action !== "inspect" ||
      shouldClearGitFailureAfterInspect(
        failureKind ??
          classifyGitFailure(pushState?.scope === scope ? pushState.result.pushError : null),
        response,
      )
    ) {
      setPushState({ result: response, snapshot, scope });
    }
    if (response.pushStatus === "pushed") notifyActionSuccess(t("commit.pushSucceeded"));
    if (["inspect", "integrate", "branch"].includes(request.action ?? "")) {
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, rootPath, "git-status"],
      });
    }
    // 推送、获取或配置都会改变比较目标；重新检查同样应刷新历史，及时移除旧标记。
    void queryClient.invalidateQueries({
      queryKey: ["projects", projectId, rootPath, "git-history"],
    });
    if (response.pushStatus === "failed" || response.pushStatus === "not_configured")
      throw new Error(response.pushError ?? t("commit.pushFailed"));
  };

  return (
    <CommitChangesPanel
      onOpenHistory={onOpenHistory}
      draftScope={JSON.stringify([projectId, rootPath])}
      error={detailsError ?? remoteQuery.error}
      gitStatus={activeGitStatus}
      pushResult={pushState?.scope === scope ? pushState.result : null}
      isPushing={pushMutation.isPending}
      // 共享请求承载多种远端动作，进度文案必须读取当前请求的真实动作。
      activeRemoteAction={pushMutation.isPending ? (pushMutation.variables.action ?? "push") : null}
      onPush={() => operateRemote({ action: "push" })}
      onRemoteAction={operateRemote}
      remoteResult={remoteQuery.data}
      isInspectingRemote={remoteQuery.isPending}
      isCommitting={commitMutation.isPending}
      isGenerating={messageMutation.isPending}
      onCommit={async (request) => {
        setPushState(undefined);
        const response = await commitMutation.mutateAsync(request);
        // 返回的状态已包含提交后的快照，结果应随新快照保留，直到下一次工作区变化。
        setResultState({ result: response, snapshot: response.status.snapshot, scope });
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
        // 提交已完成，推送失败由顶部远端卡片统一反馈，避免再次展示原始错误 toast。
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
