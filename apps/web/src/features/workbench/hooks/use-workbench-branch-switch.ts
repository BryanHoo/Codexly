import type { ProjectGitStatus } from "@codexly/protocol";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import type { WorkbenchComposerProps } from "../components/workbench-composer-contracts.js";

const gitStatusQueryKey = (projectId: string, rootPath: string) =>
  ["projects", projectId, rootPath, "git-status"] as const;
export async function switchComposerBranch(
  client: Pick<WorkbenchComposerProps["client"], "switchProjectBranch">,
  queryClient: QueryClient,
  projectId: string,
  rootPath: string,
  gitStatus: ProjectGitStatus,
  branch: string,
): Promise<boolean> {
  if (
    gitStatus.repositoryMode !== "root" ||
    gitStatus.branch === branch ||
    !gitStatus.branches.includes(branch)
  ) {
    return false;
  }
  const queryKey = gitStatusQueryKey(projectId, rootPath);
  // 先取消旧状态轮询，避免切换成功后被较早发出的响应覆盖回旧分支。
  await queryClient.cancelQueries({ exact: true, queryKey });
  const nextStatus = await client.switchProjectBranch(projectId, rootPath, {
    branch,
    expectedSnapshot: gitStatus.snapshot,
  });
  queryClient.setQueryData(queryKey, nextStatus);
  return true;
}

export async function createComposerBranch(
  client: Pick<WorkbenchComposerProps["client"], "createProjectBranch">,
  queryClient: QueryClient,
  projectId: string,
  rootPath: string,
  gitStatus: ProjectGitStatus,
  branch: string,
): Promise<boolean> {
  const normalizedBranch = branch.trim();
  if (
    gitStatus.repositoryMode !== "root" ||
    normalizedBranch.length === 0 ||
    gitStatus.branches.includes(normalizedBranch)
  ) {
    return false;
  }
  const queryKey = gitStatusQueryKey(projectId, rootPath);
  await queryClient.cancelQueries({ exact: true, queryKey });
  const nextStatus = await client.createProjectBranch(projectId, rootPath, {
    branch: normalizedBranch,
    expectedSnapshot: gitStatus.snapshot,
  });
  queryClient.setQueryData(queryKey, nextStatus);
  return true;
}

type WorkbenchBranchSwitchOptions = Readonly<{
  client: WorkbenchComposerProps["client"];
  gitStatus: ProjectGitStatus | undefined;
  isCurrentScope: (scope: string) => boolean;
  projectId: string;
  routeScope: string;
  rootPath: string;
}>;

export function useWorkbenchBranchSwitch({
  client,
  gitStatus,
  isCurrentScope,
  projectId,
  routeScope,
  rootPath,
}: WorkbenchBranchSwitchOptions) {
  const queryClient = useQueryClient();
  const branchSwitchLockRef = useRef(createAsyncActionLock());
  const [creatingBranch, setCreatingBranch] = useState<string>();
  const [switchingBranch, setSwitchingBranch] = useState<string>();
  const gitMutationPending = creatingBranch !== undefined || switchingBranch !== undefined;

  useEffect(() => {
    // 路由切换后清理旧作用域的瞬时状态，旧请求只允许更新其 Project Query。
    setCreatingBranch(undefined);
    setSwitchingBranch(undefined);
  }, [routeScope]);

  const switchBranch = async (branch: string) => {
    const requestScope = routeScope;
    if (gitStatus === undefined || gitMutationPending) {
      return;
    }
    await branchSwitchLockRef.current.run(async () => {
      setSwitchingBranch(branch);
      try {
        if (
          await switchComposerBranch(client, queryClient, projectId, rootPath, gitStatus, branch)
        ) {
          notifyActionSuccess();
        }
      } catch (error) {
        notifyActionError(error);
        await queryClient
          .invalidateQueries({ exact: true, queryKey: gitStatusQueryKey(projectId, rootPath) })
          .catch(() => undefined);
      } finally {
        if (isCurrentScope(requestScope)) {
          setSwitchingBranch(undefined);
        }
      }
    });
  };

  const createBranch = async (branch: string): Promise<boolean> => {
    const requestScope = routeScope;
    if (gitStatus === undefined || gitMutationPending) {
      return false;
    }
    const created = await branchSwitchLockRef.current.run(async () => {
      setCreatingBranch(branch);
      try {
        const created = await createComposerBranch(
          client,
          queryClient,
          projectId,
          rootPath,
          gitStatus,
          branch,
        );
        if (created) {
          notifyActionSuccess();
        }
        return created;
      } catch (error) {
        notifyActionError(error);
        await queryClient
          .invalidateQueries({ exact: true, queryKey: gitStatusQueryKey(projectId, rootPath) })
          .catch(() => undefined);
        return false;
      } finally {
        if (isCurrentScope(requestScope)) {
          setCreatingBranch(undefined);
        }
      }
    });
    return created ?? false;
  };

  return {
    createBranch,
    creatingBranch,
    switchBranch,
    switchingBranch,
  } as const;
}
