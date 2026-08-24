import type { ProjectRepository } from "@code-agent/core";
import type { FastifyReply } from "fastify";

import { ProjectRootScopeError, resolveProjectRoot } from "../project-root-scope.js";
import { MutationHttpError } from "./context.js";

export async function resolveGitReadRoot(
  repository: ProjectRepository,
  projectId: string,
  rootPath: string,
  reply: FastifyReply,
): Promise<string | undefined> {
  try {
    return await resolveProjectRoot(repository, projectId, rootPath);
  } catch (error) {
    if (error instanceof ProjectRootScopeError) {
      const status = error.code === "PROJECT_NOT_FOUND" ? 404 : 400;
      await reply.code(status).send({ code: error.code, message: error.message });
      return undefined;
    }
    throw error;
  }
}

export async function resolveGitMutationRoot(
  repository: ProjectRepository,
  projectId: string,
  rootPath: string,
): Promise<string> {
  try {
    return await resolveProjectRoot(repository, projectId, rootPath);
  } catch (error) {
    if (error instanceof ProjectRootScopeError) {
      throw new MutationHttpError(
        error.code === "PROJECT_NOT_FOUND" ? "PROJECT_NOT_FOUND" : "INVALID_REQUEST",
        error.message,
        error.code === "PROJECT_NOT_FOUND" ? 404 : 400,
      );
    }
    throw error;
  }
}

export function omitGitRootPath<T extends { rootPath: string }>(query: T): Omit<T, "rootPath"> {
  const { rootPath, ...gitQuery } = query;
  void rootPath;
  return gitQuery;
}
