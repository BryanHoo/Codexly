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
    meta: { actionNotification: false },
    mutationFn: async (request: PushProjectCommitsRequest) => {
      if (!["push", "publish", "fetch"].includes(request.action ?? ""))
        return client.pushProjectCommits(projectId, rootPath, request);
      // 点击网络动作时重新读取当前提交，不使用提交前的缓存；执行端继续校验 HEAD，拒绝真正的并发变化。
      const checked = await client.pushProjectCommits(projectId, rootPath, {
        action: "inspect",
        expectedSnapshot: request.expectedSnapshot,
        ...(request.repository === undefined ? {} : { repository: request.repository }),
      });
      if (
        (request.expectedBranch !== undefined && checked.branch !== request.expectedBranch) ||
        (request.expectedHead !== undefined && checked.remoteState?.head !== request.expectedHead)
      )
        throw new Error("Git HEAD or branch changed; check the remote status and retry");
      return client.pushProjectCommits(projectId, rootPath, {
        ...request,
        ...(checked.remoteState?.head && checked.branch
          ? { expectedHead: checked.remoteState.head, expectedBranch: checked.branch }
          : {}),
      });
    },
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
    // 快照变化后不能复用旧 HEAD/同步状态；旧版本缓存短时回收，避免编辑过程中累积元数据。
    queryKey: ["projects", projectId, rootPath, "git-remote", branch, snapshot] as const,
    queryFn: () =>
      client.pushProjectCommits(projectId, rootPath, {
        action: "inspect",
        expectedSnapshot: snapshot,
      }),
    staleTime: 15_000,
    gcTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  };
}
