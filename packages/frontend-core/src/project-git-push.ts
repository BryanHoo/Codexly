import type { PushProjectCommitsRequest, PushProjectCommitsResponse } from "@codexly/protocol";

export const gitPushChinese = {
  push: "推送",
  pushing: "推送中…",
  pushSucceeded: "推送成功",
  pushFailed: "推送失败",
  pushUpstreamMissing: "当前分支未配置上游，请先配置远端跟踪分支",
} as const;

export const gitPushEnglish = {
  push: "Push",
  pushing: "Pushing…",
  pushSucceeded: "Push succeeded",
  pushFailed: "Push failed",
  pushUpstreamMissing:
    "No upstream is configured for this branch. Configure a remote tracking branch first.",
} as const;

export function projectPushMutationOptions(
  projectId: string,
  rootPath: string,
  client: {
    pushProjectCommits(
      projectId: string,
      rootPath: string,
      request: PushProjectCommitsRequest,
    ): Promise<PushProjectCommitsResponse>;
  },
) {
  return {
    // 推送与提交共用队列，失败结果由调用方区分网络失败与未配置上游。
    meta: { actionNotification: { successMessage: false } },
    mutationFn: (request: PushProjectCommitsRequest) =>
      client.pushProjectCommits(projectId, rootPath, request),
    mutationKey: ["projects", projectId, rootPath, "git", "push"] as const,
    scope: { id: `project-git-mutation:${projectId}:${rootPath}` },
  };
}

/** 状态检查只读取 Git 主机的本地引用，复用远端接口但不触发 fetch/push。 */
export function projectGitRemoteQueryOptions(
  projectId: string,
  rootPath: string,
  branch: string | null,
  snapshot: string,
  client: {
    pushProjectCommits(
      projectId: string,
      rootPath: string,
      request: PushProjectCommitsRequest,
    ): Promise<PushProjectCommitsResponse>;
  },
) {
  return {
    queryKey: ["projects", projectId, rootPath, "git-remote", branch] as const,
    queryFn: () =>
      client.pushProjectCommits(projectId, rootPath, {
        action: "inspect",
        expectedSnapshot: snapshot,
      }),
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  };
}
