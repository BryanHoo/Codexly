import type { ProjectRepository } from "@codexly/core";
import type { ProjectRoot } from "@codexly/protocol";
import { createHash } from "node:crypto";
import { resolveProjectWorktree } from "./git-worktree.js";

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
  if (root !== undefined) return root;
  if (requestedRootPath !== undefined) {
    for (const candidate of project.roots) {
      try {
        const worktree = await resolveProjectWorktree(candidate.path, requestedRootPath);
        // worktree 属于现有 Project 的 Git 仓库，但不注册为新的 Project root。
        return {
          id: createHash("sha256").update(worktree.path).digest("hex").slice(0, 32),
          path: worktree.path,
        };
      } catch {
        // 继续检查其余根；对外统一返回无效 root，避免泄露任意路径信息。
      }
    }
  }
  throw new ProjectRootScopeError("PROJECT_ROOT_INVALID", "Project root is invalid");
}

export async function resolveProjectRoot(
  repository: Pick<ProjectRepository, "read">,
  projectId: string,
  requestedRootPath?: string,
): Promise<string> {
  return (await resolveProjectRootEntry(repository, projectId, requestedRootPath)).path;
}
