import type { ProjectRepository } from "@code-agent/core";
import type { ProjectRoot } from "@code-agent/protocol";

export type ProjectRootScopeErrorCode = "PROJECT_NOT_FOUND" | "PROJECT_ROOT_INVALID";

export class ProjectRootScopeError extends Error {
  public constructor(
    public readonly code: ProjectRootScopeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectRootScopeError";
  }
}

export async function resolveProjectRootEntry(
  repository: Pick<ProjectRepository, "read">,
  projectId: string,
  requestedRootPath?: string,
): Promise<ProjectRoot> {
  const project = await repository.read(projectId);
  if (project === undefined) {
    throw new ProjectRootScopeError("PROJECT_NOT_FOUND", "Project not found");
  }
  const root =
    requestedRootPath === undefined
      ? project.roots[0]
      : project.roots.find((candidate) => candidate.path === requestedRootPath);
  if (root === undefined) {
    // 不访问文件系统，避免通过错误差异探测 Project 外路径。
    throw new ProjectRootScopeError("PROJECT_ROOT_INVALID", "Project root is invalid");
  }
  return root;
}

export async function resolveProjectRoot(
  repository: Pick<ProjectRepository, "read">,
  projectId: string,
  requestedRootPath?: string,
): Promise<string> {
  return (await resolveProjectRootEntry(repository, projectId, requestedRootPath)).path;
}
