import { createHash } from "node:crypto";
import { basename, isAbsolute } from "node:path";

import type {
  ProjectProjectionStore,
  ProjectRepository,
  RegisterProjectInput,
} from "@codexly/core";
import type { Project, ProjectRoot } from "@codexly/protocol";

import type { CodexRpcClient } from "./agent-provider-base.js";
import { CodexProtocolMappingError, expectRecord, expectString } from "./codex-protocol-mapping.js";
import { RpcResponseError } from "./jsonl-rpc-client.js";

const PROJECT_LIST_LIMIT = 100;
const LEGACY_THREAD_LIST_LIMIT = 100;

type MappedCodexProject = Readonly<{
  position: number;
  project: Project;
}>;

type LegacyProjectMigrationOptions = Readonly<{
  recoverUnassigned: boolean;
}>;

type LegacyThread = Readonly<{
  cwd: string;
  id: string;
}>;

function expectNonEmptyString(value: unknown, context: string): string {
  const result = expectString(value, context);
  if (result.length === 0) {
    throw new CodexProtocolMappingError(`${context} must not be empty`);
  }
  return result;
}

function expectSafeInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new CodexProtocolMappingError(`${context} must be a safe integer`);
  }
  return value;
}

function mapUnixSeconds(value: unknown, context: string): string {
  const seconds = expectSafeInteger(value, context);
  if (seconds < 0) {
    throw new CodexProtocolMappingError(`${context} must not be negative`);
  }
  const date = new Date(seconds * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new CodexProtocolMappingError(`${context} is outside the supported date range`);
  }
  return date.toISOString();
}

function mapProjectRoot(value: unknown, index: number): ProjectRoot {
  const root = expectRecord(value, `Codex project root ${String(index)}`);
  const path = expectNonEmptyString(root["path"], `Codex project root ${String(index)} path`);
  if (!isAbsolute(path)) {
    throw new CodexProtocolMappingError(
      `Codex project root ${String(index)} path must be absolute`,
    );
  }
  // Codex root 只有 path；路径摘要让重复同步得到稳定且不泄露路径的公共身份。
  return { id: createHash("sha256").update(path).digest("hex"), path };
}

function validateMetadata(value: unknown): void {
  const metadata = expectRecord(value, "Codex project metadata");
  for (const [key, entry] of Object.entries(metadata)) {
    expectString(entry, `Codex project metadata ${key}`);
  }
}

function mapCodexProject(value: unknown): MappedCodexProject {
  const nativeProject = expectRecord(value, "Codex project");
  const roots = nativeProject["roots"];
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new CodexProtocolMappingError("Codex project roots must contain at least one root");
  }
  const mappedRoots = roots.map(mapProjectRoot);
  const rootPaths = mappedRoots.map((root) => root.path);
  if (new Set(rootPaths).size !== rootPaths.length) {
    throw new CodexProtocolMappingError("Codex project roots must not contain duplicates");
  }
  validateMetadata(nativeProject["metadata"]);
  // updatedAt 当前不进入公共 Project，但仍需在外部边界拒绝漂移字段。
  mapUnixSeconds(nativeProject["updatedAt"], "Codex project updatedAt");
  return {
    position: expectSafeInteger(nativeProject["position"], "Codex project position"),
    project: {
      createdAt: mapUnixSeconds(nativeProject["createdAt"], "Codex project createdAt"),
      id: expectNonEmptyString(nativeProject["id"], "Codex project id"),
      name: expectNonEmptyString(nativeProject["name"], "Codex project name"),
      roots: mappedRoots,
    },
  };
}

function responseProject(value: unknown, operation: string): MappedCodexProject {
  return mapCodexProject(expectRecord(value, `${operation} response`)["project"]);
}

function isProjectNotFoundError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    (error.code === -32600 || error.code === -32602) &&
    error.message.startsWith("project not found:")
  );
}

function mapLegacyThread(value: unknown): LegacyThread | undefined {
  const thread = expectRecord(value, "Legacy Codex thread");
  const projectId = thread["projectId"];
  if (projectId !== null) {
    throw new CodexProtocolMappingError("Legacy Codex thread projectId must be null");
  }
  if (typeof thread["ephemeral"] !== "boolean") {
    throw new CodexProtocolMappingError("Legacy Codex thread ephemeral must be a boolean");
  }
  const historyMode = expectString(thread["historyMode"], "Legacy Codex thread historyMode");
  const source = expectString(thread["source"], "Legacy Codex thread source");
  if (historyMode !== "legacy" && historyMode !== "paginated") {
    throw new CodexProtocolMappingError("Legacy Codex thread historyMode is unsupported");
  }
  if (source !== "vscode") {
    throw new CodexProtocolMappingError("Legacy Codex thread source must be vscode");
  }
  if (thread["ephemeral"]) {
    return undefined;
  }
  const cwd = expectNonEmptyString(thread["cwd"], "Legacy Codex thread cwd");
  if (!isAbsolute(cwd)) {
    throw new CodexProtocolMappingError("Legacy Codex thread cwd must be absolute");
  }
  return {
    cwd,
    id: expectNonEmptyString(thread["id"], "Legacy Codex thread id"),
  };
}

function unassignedMigrationKey(rootPath: string): string {
  return `codexly:unassigned-vscode:${createHash("sha256").update(rootPath).digest("hex")}`;
}

function primaryRootPath(project: Project): string {
  const primary = project.roots[0];
  if (primary === undefined) {
    throw new CodexProtocolMappingError("Project roots must contain a primary root");
  }
  return primary.path;
}

export class CodexProjectRepository implements ProjectRepository {
  readonly #client: Pick<CodexRpcClient, "request">;
  readonly #projection: ProjectProjectionStore;

  public constructor(client: Pick<CodexRpcClient, "request">, projection: ProjectProjectionStore) {
    this.#client = client;
    this.#projection = projection;
  }

  public list(): Promise<readonly Project[]> {
    return this.synchronize();
  }

  public async migrateLegacyProjects(options: LegacyProjectMigrationOptions): Promise<void> {
    const localProjects = await this.#projection.list();
    const upstreamProjects = await this.#listCodexProjects();
    const localRoots = [...new Set(localProjects.map(primaryRootPath))];
    if (localRoots.length === 0 && !options.recoverUnassigned) {
      return;
    }
    const legacyThreads = await this.#listLegacyThreads(
      options.recoverUnassigned ? undefined : localRoots,
    );
    const threadsByRoot = new Map<string, LegacyThread[]>();
    for (const thread of legacyThreads) {
      const threads = threadsByRoot.get(thread.cwd) ?? [];
      threads.push(thread);
      threadsByRoot.set(thread.cwd, threads);
    }

    const handledRoots = new Set<string>();
    for (const localProject of localProjects) {
      const localRootPath = primaryRootPath(localProject);
      handledRoots.add(localRootPath);
      const threads = threadsByRoot.get(localRootPath) ?? [];
      // 同一路径允许存在多个上游 Project；已有 Codex ID 必须优先于迁移期路径回退。
      const upstream =
        upstreamProjects.find((project) => project.project.id === localProject.id) ??
        upstreamProjects.find((project) => primaryRootPath(project.project) === localRootPath);
      if (upstream !== undefined) {
        await this.#assignThreads(upstream.project.id, threads);
        if (upstream.project.id !== localProject.id) {
          await this.#projection.migrateProject(localProject.id, upstream.project);
        }
        continue;
      }
      const imported = responseProject(
        await this.#client.request("project/import", {
          idempotencyKey: `codexly:legacy-project:${localProject.id}`,
          metadata: { codexlyMigration: "legacy-project-v1" },
          name: localProject.name,
          roots: [{ path: localRootPath }],
          threads: threads.map((thread) => thread.id),
        }),
        "project/import",
      );
      upstreamProjects.push(imported);
      await this.#projection.migrateProject(localProject.id, imported.project);
    }

    if (!options.recoverUnassigned) {
      return;
    }
    for (const [rootPath, threads] of threadsByRoot) {
      if (handledRoots.has(rootPath)) {
        continue;
      }
      const upstream = upstreamProjects.find(
        (project) => primaryRootPath(project.project) === rootPath,
      );
      if (upstream !== undefined) {
        await this.#assignThreads(upstream.project.id, threads);
        continue;
      }
      const imported = responseProject(
        await this.#client.request("project/import", {
          idempotencyKey: unassignedMigrationKey(rootPath),
          metadata: { codexlyMigration: "unassigned-vscode-v2" },
          name: basename(rootPath) || rootPath,
          roots: [{ path: rootPath }],
          threads: threads.map((thread) => thread.id),
        }),
        "project/import",
      );
      upstreamProjects.push(imported);
      await this.#projection.upsertProject(imported.project);
    }
  }

  public async read(projectId: string): Promise<Project | undefined> {
    try {
      const mapped = responseProject(
        await this.#client.request("project/read", { projectId }),
        "project/read",
      );
      return await this.#projection.upsertProject(mapped.project);
    } catch (error) {
      if (isProjectNotFoundError(error)) {
        await this.#projection.deleteProject(projectId);
        return undefined;
      }
      throw error;
    }
  }

  public async register(input: RegisterProjectInput): Promise<Project> {
    const mapped = responseProject(
      await this.#client.request("project/create", {
        idempotencyKey: input.idempotencyKey,
        metadata: {},
        name: input.name,
        roots: input.roots.map(({ path }) => ({ path })),
      }),
      "project/create",
    );
    return this.#projection.upsertProject(mapped.project);
  }

  public async rename(projectId: string, name: string): Promise<Project | undefined> {
    try {
      const mapped = responseProject(
        await this.#client.request("project/update", { name, projectId }),
        "project/update",
      );
      return await this.#projection.upsertProject(mapped.project);
    } catch (error) {
      if (isProjectNotFoundError(error)) {
        await this.#projection.deleteProject(projectId);
        return undefined;
      }
      throw error;
    }
  }

  public async remove(projectId: string): Promise<boolean> {
    try {
      expectRecord(
        await this.#client.request("project/delete", { projectId }),
        "project/delete response",
      );
      await this.#projection.deleteProject(projectId);
      return true;
    } catch (error) {
      if (isProjectNotFoundError(error)) {
        await this.#projection.deleteProject(projectId);
        return false;
      }
      throw error;
    }
  }

  public async reorder(projectIds: readonly string[]): Promise<readonly Project[]> {
    const projected = await this.#projection.list();
    const projectedIds = new Set(projected.map((project) => project.id));
    if (
      projectIds.length !== projected.length ||
      new Set(projectIds).size !== projectedIds.size ||
      !projectIds.every((projectId) => projectedIds.has(projectId))
    ) {
      throw new Error("Project order must contain every project exactly once");
    }
    try {
      for (let index = projectIds.length - 1; index >= 0; index -= 1) {
        expectRecord(
          await this.#client.request("project/move", {
            beforeProjectId: projectIds[index + 1] ?? null,
            projectId: projectIds[index],
          }),
          "project/move response",
        );
      }
    } catch (error) {
      // 多次 move 不是一个 RPC 事务，失败后立即按上游真相修复本地投影。
      await this.synchronize();
      throw error;
    }
    return this.#projection.setProjectOrder(projectIds);
  }

  public async synchronize(): Promise<readonly Project[]> {
    const mappedProjects = await this.#listCodexProjects();
    return this.#projection.replaceProjects(mappedProjects.map(({ project }) => project));
  }

  async #assignThreads(projectId: string, threads: readonly LegacyThread[]): Promise<void> {
    for (const thread of threads) {
      const response = expectRecord(
        await this.#client.request("thread/metadata/update", {
          projectId,
          threadId: thread.id,
        }),
        "thread/metadata/update response",
      );
      const updatedThread = expectRecord(response["thread"], "thread/metadata/update thread");
      if (updatedThread["id"] !== thread.id || updatedThread["projectId"] !== projectId) {
        throw new CodexProtocolMappingError(
          "thread/metadata/update returned an unexpected project assignment",
        );
      }
    }
  }

  async #listCodexProjects(): Promise<MappedCodexProject[]> {
    const mappedProjects: MappedCodexProject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = expectRecord(
        await this.#client.request("project/list", {
          ...(cursor === undefined ? {} : { cursor }),
          limit: PROJECT_LIST_LIMIT,
        }),
        "project/list response",
      );
      if (!Array.isArray(response["data"])) {
        throw new CodexProtocolMappingError("project/list data must be an array");
      }
      mappedProjects.push(...response["data"].map(mapCodexProject));
      const nextCursor = response["nextCursor"];
      if (nextCursor === null) {
        cursor = undefined;
      } else {
        const next = expectNonEmptyString(nextCursor, "project/list nextCursor");
        if (seenCursors.has(next)) {
          throw new CodexProtocolMappingError("project/list returned a repeated cursor");
        }
        seenCursors.add(next);
        cursor = next;
      }
    } while (cursor !== undefined);

    mappedProjects.sort(
      (left, right) =>
        left.position - right.position || left.project.id.localeCompare(right.project.id),
    );
    const projects = mappedProjects.map(({ project }) => project);
    if (new Set(projects.map((project) => project.id)).size !== projects.length) {
      throw new CodexProtocolMappingError("project/list returned duplicate project ids");
    }
    return mappedProjects;
  }

  async #listLegacyThreads(cwds: readonly string[] | undefined): Promise<LegacyThread[]> {
    const active = await this.#listLegacyThreadsByArchivedState(cwds, false);
    const archived = await this.#listLegacyThreadsByArchivedState(cwds, true);
    return [...active, ...archived];
  }

  async #listLegacyThreadsByArchivedState(
    cwds: readonly string[] | undefined,
    archived: boolean,
  ): Promise<LegacyThread[]> {
    const threads: LegacyThread[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = expectRecord(
        await this.#client.request("thread/list", {
          ...(cursor === undefined ? {} : { cursor }),
          ...(cwds === undefined ? {} : { cwd: cwds }),
          archived,
          limit: LEGACY_THREAD_LIST_LIMIT,
          projectId: null,
          sourceKinds: ["vscode"],
        }),
        "Legacy thread/list response",
      );
      if (!Array.isArray(response["data"])) {
        throw new CodexProtocolMappingError("Legacy thread/list data must be an array");
      }
      for (const value of response["data"]) {
        const thread = mapLegacyThread(value);
        if (thread !== undefined) {
          threads.push(thread);
        }
      }
      const nextCursor = response["nextCursor"];
      if (nextCursor === null) {
        cursor = undefined;
      } else {
        const next = expectNonEmptyString(nextCursor, "Legacy thread/list nextCursor");
        if (seenCursors.has(next)) {
          throw new CodexProtocolMappingError("Legacy thread/list returned a repeated cursor");
        }
        seenCursors.add(next);
        cursor = next;
      }
    } while (cursor !== undefined);
    return threads;
  }
}
