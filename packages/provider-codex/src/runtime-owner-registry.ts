import { resolve, win32 } from "node:path";

import type { AgentTaskScope } from "@codexly/core";

import { CodexProtocolMappingError } from "./codex-protocol-mapping.js";

type TaskOwner = Readonly<{ projectId: string; provisional: boolean; rootPath: string }>;

export function normalizedPathIdentity(path: string): string {
  if (win32.isAbsolute(path)) {
    return win32.resolve(path).toLocaleLowerCase("en-US");
  }
  return resolve(path);
}

export function isSameResolvedPath(left: string, right: string): boolean {
  return normalizedPathIdentity(left) === normalizedPathIdentity(right);
}

/** 唯一维护全局 Task 归属，阻止通知和 Mutation 跨 Project 路由。 */
export class RuntimeOwnerRegistry {
  readonly #taskOwners = new Map<string, TaskOwner>();

  public beginTaskRead(project: AgentTaskScope, taskId: string): boolean {
    const owner = this.#taskOwners.get(taskId);
    if (owner !== undefined) {
      return owner.projectId === project.id && isSameResolvedPath(owner.rootPath, project.rootPath);
    }
    this.#taskOwners.set(taskId, {
      projectId: project.id,
      provisional: true,
      rootPath: project.rootPath,
    });
    return true;
  }

  public claimTask(project: AgentTaskScope, taskId: string): void {
    const owner = this.#taskOwners.get(taskId);
    if (
      owner !== undefined &&
      (owner.projectId !== project.id || !isSameResolvedPath(owner.rootPath, project.rootPath))
    ) {
      throw new CodexProtocolMappingError("Codex thread belongs to another project");
    }
    this.#taskOwners.set(taskId, {
      projectId: project.id,
      provisional: false,
      rootPath: project.rootPath,
    });
  }

  public assertTaskOwner(project: AgentTaskScope, taskId: string): void {
    if (!this.isTaskOwner(project, taskId)) {
      throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
    }
  }

  public isTaskOwner(project: AgentTaskScope, taskId: string): boolean {
    const owner = this.#taskOwners.get(taskId);
    return (
      owner !== undefined &&
      !owner.provisional &&
      owner.projectId === project.id &&
      isSameResolvedPath(owner.rootPath, project.rootPath)
    );
  }

  public projectIdForTask(taskId: string): string | undefined {
    return this.#taskOwners.get(taskId)?.projectId;
  }

  public releaseTask(project: AgentTaskScope, taskId: string): void {
    if (this.isTaskOwner(project, taskId)) {
      this.#taskOwners.delete(taskId);
    }
  }

  public releaseProvisionalTask(project: AgentTaskScope, taskId: string): void {
    const owner = this.#taskOwners.get(taskId);
    if (owner?.provisional === true && owner.projectId === project.id) {
      this.#taskOwners.delete(taskId);
    }
  }

  public releaseProject(projectId: string): void {
    for (const [taskId, owner] of this.#taskOwners) {
      if (owner.projectId === projectId) {
        this.#taskOwners.delete(taskId);
      }
    }
  }
}
