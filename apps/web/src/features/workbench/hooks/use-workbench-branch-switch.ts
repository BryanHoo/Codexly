import type {
  Project,
  ProjectGitStatus,
  ProjectGitWorktree,
  ProjectGitWorktreePage,
  ProjectPage,
  ProjectWorktreeMutationResponse,
} from "@codexly/protocol";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { createAsyncActionLock } from "../../../shared/utils/async-action-lock.js";
import {
  notifyActionError,
  notifyActionSuccess,
} from "../../notifications/action-notifications.js";
import type { WorkbenchComposerProps } from "../components/workbench-composer-contracts.js";
import { upsertProjectInPage } from "../../projects/project-query-cache.js";
import { useProjectData } from "../../projects/project-context.js";

const gitStatusQueryKey = (projectId: string, rootPath: string) =>
  ["projects", projectId, rootPath, "git-status"] as const;
const gitWorktreesQueryKey = (projectId: string, rootPath: string) =>
  ["projects", projectId, rootPath, "git-worktrees"] as const;

function cacheProjectWorktreeMutation(
  queryClient: QueryClient,
  projectId: string,
  rootPath: string,
  response: ProjectWorktreeMutationResponse,
) {
  queryClient.setQueryData<ProjectPage>(["projects"], (currentPage) =>
    upsertProjectInPage(currentPage, response.project),
  );
  queryClient.setQueryData<ProjectGitWorktreePage>(
    gitWorktreesQueryKey(projectId, rootPath),
    (currentPage) => {
      const worktrees = currentPage?.worktrees ?? [];
      const existingIndex = worktrees.findIndex(
        (worktree) => worktree.path === response.worktree.path,
      );
      return {
        worktrees:
          existingIndex < 0
            ? [...worktrees, response.worktree]
            : worktrees.map((worktree, index) =>
                index === existingIndex ? response.worktree : worktree,
              ),
      };
    },
  );
}

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

export async function createComposerWorktree(
  client: Pick<WorkbenchComposerProps["client"], "createProjectWorktree">,
  queryClient: QueryClient,
  projectId: string,
  rootPath: string,
  gitStatus: ProjectGitStatus,
  branch: string,
): Promise<Project | undefined> {
  const normalizedBranch = branch.trim();
  if (gitStatus.repositoryMode !== "root" || normalizedBranch.length === 0) return undefined;
  const response = await client.createProjectWorktree(projectId, rootPath, {
    branch: normalizedBranch,
    expectedSnapshot: gitStatus.snapshot,
  });
  cacheProjectWorktreeMutation(queryClient, projectId, rootPath, response);
  await queryClient.invalidateQueries({
    exact: true,
    queryKey: gitStatusQueryKey(projectId, rootPath),
    refetchType: "none",
  });
  return response.project;
}

export async function switchComposerWorktree(
  client: Pick<WorkbenchComposerProps["client"], "switchProjectWorktree">,
  queryClient: QueryClient,
  projectId: string,
  rootPath: string,
  worktrees: readonly ProjectGitWorktree[],
  path: string,
): Promise<Project | undefined> {
  const worktree = worktrees.find((candidate) => candidate.path === path && !candidate.current);
  if (worktree === undefined) return undefined;
  const response = await client.switchProjectWorktree(projectId, rootPath, { path });
  cacheProjectWorktreeMutation(queryClient, projectId, rootPath, response);
  return response.project;
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { projects } = useProjectData();
  const branchSwitchLockRef = useRef(createAsyncActionLock());
  const [creatingBranch, setCreatingBranch] = useState<string>();
  const [creatingWorktree, setCreatingWorktree] = useState<string>();
  const [switchingBranch, setSwitchingBranch] = useState<string>();
  const [switchingWorktree, setSwitchingWorktree] = useState<string>();
  const [worktreeNavigation, setWorktreeNavigation] = useState<
    Readonly<{ projectId: string; routeScope: string }> | undefined
  >();
  const gitMutationPending =
    creatingBranch !== undefined ||
    creatingWorktree !== undefined ||
    switchingBranch !== undefined ||
    switchingWorktree !== undefined;
  const worktreesQuery = useQuery({
    enabled: gitStatus?.repositoryMode === "root",
    queryFn: ({ signal }) => client.listProjectWorktrees(projectId, rootPath, { signal }),
    queryKey: gitWorktreesQueryKey(projectId, rootPath),
    staleTime: 5_000,
  });
  const worktrees = worktreesQuery.data?.worktrees ?? [];

  useEffect(() => {
    const targetProjectId =
      worktreeNavigation?.routeScope === routeScope ? worktreeNavigation.projectId : undefined;
    if (
      targetProjectId === undefined ||
      !projects.some((project) => project.id === targetProjectId)
    ) {
      return;
    }
    // 等 ProjectProvider 发布新列表后再导航，避免 Sidebar 将目标误判为已删除项目。
    void navigate({
      params: { projectId: targetProjectId },
      to: "/p/$projectId",
    });
  }, [navigate, projects, routeScope, worktreeNavigation]);

  useEffect(() => {
    // 路由切换后清理旧作用域的瞬时状态，旧请求只允许更新其 Project Query。
    setCreatingBranch(undefined);
    setCreatingWorktree(undefined);
    setSwitchingBranch(undefined);
    setSwitchingWorktree(undefined);
    setWorktreeNavigation(undefined);
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

  const createWorktree = async (branch: string): Promise<boolean> => {
    const requestScope = routeScope;
    if (gitStatus === undefined || gitMutationPending) {
      return false;
    }
    const created = await branchSwitchLockRef.current.run(async () => {
      setCreatingWorktree(branch);
      try {
        const project = await createComposerWorktree(
          client,
          queryClient,
          projectId,
          rootPath,
          gitStatus,
          branch,
        );
        if (project === undefined) return false;
        notifyActionSuccess();
        setWorktreeNavigation({ projectId: project.id, routeScope: requestScope });
        return true;
      } catch (error) {
        notifyActionError(error);
        await queryClient
          .invalidateQueries({ exact: true, queryKey: gitWorktreesQueryKey(projectId, rootPath) })
          .catch(() => undefined);
        return false;
      } finally {
        if (isCurrentScope(requestScope)) setCreatingWorktree(undefined);
      }
    });
    return created ?? false;
  };

  const switchWorktree = async (path: string) => {
    const requestScope = routeScope;
    if (gitMutationPending) {
      return;
    }
    await branchSwitchLockRef.current.run(async () => {
      setSwitchingWorktree(path);
      try {
        const project = await switchComposerWorktree(
          client,
          queryClient,
          projectId,
          rootPath,
          worktrees,
          path,
        );
        if (project === undefined) return;
        notifyActionSuccess();
        setWorktreeNavigation({ projectId: project.id, routeScope: requestScope });
      } catch (error) {
        notifyActionError(error);
        await queryClient
          .invalidateQueries({ exact: true, queryKey: gitWorktreesQueryKey(projectId, rootPath) })
          .catch(() => undefined);
      } finally {
        if (isCurrentScope(requestScope)) setSwitchingWorktree(undefined);
      }
    });
  };

  return {
    createBranch,
    creatingBranch,
    createWorktree,
    creatingWorktree,
    switchBranch,
    switchingBranch,
    switchWorktree,
    switchingWorktree,
    worktrees,
  } as const;
}
