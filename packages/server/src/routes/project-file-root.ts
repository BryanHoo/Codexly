import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import type { ProjectRepository } from "@codexly/core";
import type { FastifyReply } from "fastify";
import { ProjectRootScopeError, resolveProjectRootEntry } from "../project-root-scope.js";
import type { ServerRouteContext } from "./context.js";

export async function resolveReadRoot(
  repository: ProjectRepository,
  getProjectContext: ServerRouteContext["getProjectContext"],
  projectId: string,
  rootPath: string | undefined,
  reply: FastifyReply,
): Promise<Readonly<{ id: string; path: string }> | undefined> {
  try {
    return await resolveProjectFileRoot(repository, getProjectContext, projectId, rootPath);
  } catch (error) {
    if (error instanceof ProjectRootScopeError) {
      const status = error.code === "PROJECT_NOT_FOUND" ? 404 : 400;
      await reply.code(status).send({ code: error.code, message: error.message });
      return undefined;
    }
    throw error;
  }
}

export async function resolveProjectFileRoot(
  repository: ProjectRepository,
  getProjectContext: ServerRouteContext["getProjectContext"],
  projectId: string,
  rootPath: string | undefined,
): Promise<Readonly<{ id: string; path: string }>> {
  if (projectId === TEMPORARY_TASK_SCOPE_ID) {
    const temporaryRoot = (await getProjectContext(projectId))?.scope.rootPath;
    if (temporaryRoot === undefined) {
      throw new ProjectRootScopeError("PROJECT_NOT_FOUND", "Project not found");
    }
    return { id: TEMPORARY_TASK_SCOPE_ID, path: temporaryRoot };
  }
  if (rootPath === undefined) {
    throw new ProjectRootScopeError("PROJECT_ROOT_INVALID", "Project root is required");
  }
  return resolveProjectRootEntry(repository, projectId, rootPath);
}
