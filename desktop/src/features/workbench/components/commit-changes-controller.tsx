import { classifyGitFailure, type GitFailureKind } from "@codexly/frontend-core/git-recovery";
import type { PushProjectCommitsRequest } from "@codexly/protocol";
import { shouldClearGitFailureAfterInspect, projectPushMutationOptions, projectGitRemoteQueryOptions, projectGitRemoteMutationCallbacks } from "@codexly/frontend-core/project-git-push";
import type { CommitProjectChangesResponse, PushProjectCommitsResponse, ProjectGitStatus } from "@/protocol/index.js";
import { useMutation, useQuery, useIsMutating, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

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
} from "../../projects/project-queries.js";
import { CommitChangesPanel } from "./commit-changes-panel.js";
import { useCommitStatusPages } from "../hooks/use-commit-status-pages.js";
import { loadProjectGitFileDiff } from "../project-git-file-diff.js";
import { useTranslation } from "../../../i18n/i18n.js";

type CommitChangesControllerProps = Readonly<{
  client: NativeWorkbenchClient;
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
  const messageMutation = useMutation(
    { ...projectCommitMessageMutationOptions(projectId, rootPath, client), meta: { actionNotification: false } },
  );
  const commitMutation = useMutation({
    ...projectCommitChangesMutationOptions(projectId, rootPath, client),
    ...projectGitRemoteMutationCallbacks(projectId, rootPath, queryClient),
    meta: { actionNotification: false },
  });
  const pushMutation = useMutation(projectPushMutationOptions(projectId, rootPath, client));
  const [pushState, setPushState] = useState<{ result: PushProjectCommitsResponse; snapshot: string; scope: string }>();
  const [resultState, setResultState] = useState<{
    result: CommitProjectChangesResponse;
    snapshot: string;
    scope: string;
  }>();
  const [refreshingAfterCommit, setRefreshingAfterCommit] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const previewRequest = useRef(0);
  useEffect(() => () => { previewRequest.current++; }, [projectId, rootPath]);
  const pages = useCommitStatusPages(client, projectId, rootPath, null, gitStatus);
  const activeGitStatus = pages.status;
  const scope = JSON.stringify([projectId, rootPath, activeGitStatus.branch]);
  const result = resultState?.scope === scope ? resultState.result : null;
  // 同仓库任意窗口的 Git 写操作尚未完成时，暂停自动检查；原生提交收尾期间也保持暂停。
  const writing = useIsMutating({ predicate: (mutation) => mutation.options.scope?.id === `project-git-mutation:${projectId}:${rootPath}` }) > 0 || refreshingAfterCommit;
  const remoteOptions = projectGitRemoteQueryOptions(projectId, rootPath, activeGitStatus.branch, activeGitStatus.snapshot, client, writing);
  const remoteQuery = useQuery({ ...remoteOptions, enabled: activeGitStatus.repositoryMode === "root" && remoteOptions.enabled });
  const operateRemote = async (request: Omit<PushProjectCommitsRequest, "expectedSnapshot">, failureKind?: GitFailureKind) => {
    const snapshot = activeGitStatus.snapshot;
    let response: PushProjectCommitsResponse;
    try {
      response = await pushMutation.mutateAsync({ ...request, expectedSnapshot: snapshot,
        ...(["push", "publish", "fetch"].includes(request.action ?? "") && activeGitStatus.branch ? { expectedBranch: activeGitStatus.branch } : {}),
      });
    } catch (error) {
      setPushState({ result: { branch: activeGitStatus.branch, pushStatus: "failed", pushError: error instanceof Error ? error.message : String(error) }, snapshot, scope });
      void queryClient.invalidateQueries({ queryKey: remoteOptions.queryKey });
      throw error;
    }
    if (response.remoteState) queryClient.setQueryData(remoteOptions.queryKey, response);
    // 刷新已核对的状态变化后恢复正常操作；本地检查不能抹去仍未验证的连接失败。
    if (request.action !== "inspect" || shouldClearGitFailureAfterInspect(failureKind ?? classifyGitFailure(pushState?.scope === scope ? pushState.result.pushError : null), response)) {
      setPushState({ result: response, snapshot, scope });
    }
    if (response.pushStatus === "pushed") notifyActionSuccess(t("commit.pushSucceeded"));
    if (["inspect", "integrate", "branch"].includes(request.action ?? "")) {
      await queryClient.invalidateQueries({ queryKey: ["projects", projectId, rootPath, "git-status"] });
    }
    // 推送、获取或配置都会改变比较目标；重新检查同样应刷新历史，及时移除旧标记。
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId, rootPath, "git-history"] });
    if (response.pushStatus === "failed" || response.pushStatus === "not_configured")
      throw new Error(response.pushError ?? t("commit.pushFailed"));
  };

  const statusError = detailsError ?? pages.error ?? remoteQuery.error;

  useEffect(() => {
    if (statusError !== null) {
      recordInternalWarning("git_status_details_query_failed", statusError, { projectId });
    }
  }, [projectId, statusError]);

  return (
    <CommitChangesPanel
      onOpenHistory={onOpenHistory}
      draftScope={JSON.stringify([projectId, rootPath])}
      error={statusError}
      gitStatus={activeGitStatus}
      pushResult={pushState?.scope === scope ? pushState.result : null}
      isPushing={pushMutation.isPending}
      // 共享请求承载多种远端动作，进度文案必须读取当前请求的真实动作。
      activeRemoteAction={pushMutation.isPending ? (pushMutation.variables.action ?? "push") : null}
      onPush={() => operateRemote({ action: "push" })}
      onRemoteAction={operateRemote}
      remoteResult={remoteQuery.data}
      isInspectingRemote={remoteQuery.isPending}
      isCommitting={commitMutation.isPending || refreshingAfterCommit}
      isGenerating={messageMutation.isPending}
      onCommit={async (request) => {
        setPushState(undefined);
        setRefreshingAfterCommit(true);
        try {
          const submittedSnapshot = request.expectedSnapshot;
          const response = await commitMutation.mutateAsync(request);
          setResultState({ result: response, snapshot: submittedSnapshot, scope });
          await queryClient.invalidateQueries({
            queryKey: ["projects", projectId, rootPath, "git-status"],
          });
          // 提交成功信息绑定刷新后的权威快照；剩余文件可继续提交，干净工作区可继续推送。
          const refreshedStatus = queryClient.getQueryData<ProjectGitStatus>(["projects", projectId, rootPath, "git-status"]);
          if (refreshedStatus !== undefined) {
            setResultState({ result: response, snapshot: refreshedStatus.snapshot, scope });
          }
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
          // 提交已完成，推送失败由顶部远端卡片统一反馈，避免再次展示原始错误 toast。
        } finally {
          setRefreshingAfterCommit(false);
        }
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
          null)
          .then((loaded) => { if (request === previewRequest.current) onOpenFileDiff(loaded); })
          .catch((error: unknown) => { if (request === previewRequest.current) notifyActionError(error); })
          .finally(() => { if (request === previewRequest.current) setLoadingDiff(false); });
      }}
      result={result}
    />
  );
}
