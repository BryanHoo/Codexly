import { realpath } from "node:fs/promises";
import type {
  AgentTaskScope,
  AgentProviderEvent,
  AgentProviderEventListener,
  AgentProviderTaskSnapshot,
} from "@code-agent/core";
import type {
  AgentCapabilities,
  AgentMessageAttachment,
  AgentMcpServerPage,
  AgentModelPage,
  AgentSandboxMode,
  AgentSkillPage,
  AgentTask,
} from "@code-agent/protocol";
import {
  RpcResponseError,
  type RpcErrorPayload,
  type RpcRequestId,
  type RpcServerRequest,
} from "./jsonl-rpc-client.js";
import { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";
import { PendingRequestLifecycle } from "./pending-request-lifecycle.js";
import { listCodexMcpServers, reloadCodexMcpServers } from "./agent-provider-mcp.js";
import { TaskRuntimeState } from "./task-runtime-state.js";
import { normalizedPathIdentity } from "./runtime-owner-registry.js";
import { mapCodexProjectStateNotification } from "./agent-provider-notifications.js";
import { warnDroppedCodexNotification } from "./agent-provider-diagnostics.js";
import { DEFAULT_PROVIDER_LOGGER, type CodexProviderLogger } from "./agent-provider-logger.js";
import * as taskArchive from "./agent-provider-task-archive.js";
import { releaseCodexProjectThreads } from "./thread-unsubscribe.js";
import {
  CodexProtocolMappingError,
  type CodexSkill,
  expectRecord,
  expectString,
  isRecord,
  mapAgentModel,
  mapCodexSkill,
  mapSandboxMode,
  normalizedTitle,
  toDateTime,
} from "./codex-protocol-mapping.js";

export { CodexProtocolMappingError } from "./codex-protocol-mapping.js";

export interface CodexRpcClient {
  notify(method: string, params?: unknown): void;
  onNotification(listener: (notification: { method: string; params: unknown }) => void): () => void;
  onServerRequest(listener: (request: RpcServerRequest) => void): () => void;
  rejectServerRequest(id: RpcRequestId, error: RpcErrorPayload): Promise<void>;
  request(method: string, params?: unknown): Promise<unknown>;
  respondToServerRequest(id: RpcRequestId, result: unknown): Promise<void> | void;
}

export interface CreateCodexRuntimeProviderOptions {
  client: CodexRpcClient;
  fetch?: typeof globalThis.fetch;
  logger?: CodexProviderLogger;
}

export const CODEX_PINNED_THREAD_SECTION_ID = "01984de2-8f74-7c91-a3b2-5c5e937cf318";

function isPinnedThreadSection(value: unknown): boolean {
  if (value === null) {
    return false;
  }
  const section = expectRecord(value, "Codex thread section");
  const sectionId = expectString(section["id"], "Codex thread section id");
  expectString(section["name"], "Codex thread section name");
  const appearance = section["appearance"];
  if (
    appearance !== null &&
    (!isRecord(appearance) ||
      (appearance["icon"] !== null && typeof appearance["icon"] !== "string") ||
      (appearance["color"] !== null && typeof appearance["color"] !== "string"))
  ) {
    throw new CodexProtocolMappingError("Codex thread section appearance is invalid");
  }
  return sectionId === CODEX_PINNED_THREAD_SECTION_ID;
}

export async function canonicalPathIdentity(path: string): Promise<string> {
  try {
    // 历史 Thread 可能保留符号链接路径，归属校验需要与已注册 Project 的真实路径对齐。
    return normalizedPathIdentity(await realpath(path));
  } catch {
    return normalizedPathIdentity(path);
  }
}

export async function isSameCanonicalPath(left: string, right: string): Promise<boolean> {
  const [leftIdentity, rightIdentity] = await Promise.all([
    canonicalPathIdentity(left),
    canonicalPathIdentity(right),
  ]);
  return leftIdentity === rightIdentity;
}

export async function isProjectThread(
  thread: Record<string, unknown>,
  project: AgentTaskScope,
): Promise<boolean> {
  const nativeProjectId = thread["projectId"];
  if (nativeProjectId !== null && typeof nativeProjectId !== "string") {
    throw new CodexProtocolMappingError("Codex thread projectId must be a string or null");
  }
  if (project.kind === "project") {
    return nativeProjectId === project.id;
  }
  if (nativeProjectId !== null) {
    return false;
  }
  const cwd = expectString(thread["cwd"], "Codex thread cwd");
  return isSameCanonicalPath(cwd, project.rootPath);
}

export async function assertProjectThread(
  thread: Record<string, unknown>,
  project: AgentTaskScope,
): Promise<void> {
  if (!(await isProjectThread(thread, project))) {
    throw new CodexProtocolMappingError("Codex thread does not belong to the active project");
  }
}

export function isThreadNotLoadedError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.startsWith("thread not loaded:")
  );
}

export function isBackgroundTerminalThreadMissingError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    error.message.startsWith("thread not found:")
  );
}

export function isThreadNotMaterializedError(error: unknown): boolean {
  return (
    error instanceof RpcResponseError &&
    error.code === -32600 &&
    (error.message.includes(
      "is not materialized yet; includeTurns is unavailable before first user message",
    ) ||
      error.message.includes(
        "is not materialized yet; thread/turns/list is unavailable before first user message",
      ))
  );
}

export function createUnmaterializedTaskSnapshot(task: AgentTask): AgentProviderTaskSnapshot {
  return {
    ...task,
    contextUsage: null,
    plan: null,
    pendingRequests: [],
    status: "idle",
    turns: [],
    turnsNextCursor: null,
  };
}

export async function mapAgentTask(
  thread: Record<string, unknown>,
  project: AgentTaskScope,
): Promise<AgentTask> {
  await assertProjectThread(thread, project);
  return {
    id: expectString(thread["id"], "Codex thread id"),
    pinned: isPinnedThreadSection(thread["section"]),
    projectId: project.id,
    title: normalizedTitle(thread),
    updatedAt: toDateTime(thread["updatedAt"], "Codex thread updatedAt"),
  };
}

export abstract class CodexAgentProviderBase {
  protected readonly client: CodexRpcClient;
  protected readonly eventListenersIncludingEphemeral = new Set<AgentProviderEventListener>();
  protected readonly eventListeners = new Set<AgentProviderEventListener>();
  protected readonly historicalAttachments = new CodexHistoricalAttachmentStore();
  protected readonly logger: CodexProviderLogger;
  protected readonly project: AgentTaskScope;
  protected readonly pendingLifecycle: PendingRequestLifecycle;
  protected readonly runtime = new TaskRuntimeState();
  protected readonly skillsById = new Map<string, CodexSkill>();

  protected abstract assertKnownProjectTask(taskId: string): void;
  protected abstract clearTaskRuntimeState(taskId: string): void;
  protected abstract finishTaskRead(taskId: string, projectOwnershipVerified: boolean): void;
  protected abstract hasTaskLifecycleObligations(taskId: string): boolean;
  protected abstract mapMessageImage(
    taskId: string,
    part: Record<string, unknown>,
    imageIndex: number,
  ): AgentMessageAttachment | undefined;
  protected abstract mapMessageText(
    taskId: string,
    input: Readonly<{ name: string; text: string }>,
    textIndex: number,
  ): AgentMessageAttachment | undefined;
  protected abstract promotePendingServerRequests(taskId: string): void;
  protected abstract resumeTask(taskId: string): Promise<void>;
  protected abstract routeEvent(event: AgentProviderEvent): void;
  public abstract receiveNotification(method: string, params: unknown): void;
  public abstract receiveServerRequest(request: RpcServerRequest): void;

  protected handleProjectStateNotification(method: string, params: unknown): boolean {
    if (
      method !== "skills/changed" &&
      method !== "thread/archived" &&
      method !== "thread/deleted" &&
      method !== "thread/name/updated" &&
      method !== "thread/queue/changed" &&
      method !== "thread/status/changed"
    ) {
      return false;
    }
    try {
      const event = mapCodexProjectStateNotification(method, params);
      if (event === undefined) return true;
      if (event.type === "skills.changed") {
        this.skillsById.clear();
        this.routeEvent({ ...event, taskId: this.project.id });
        return true;
      }
      if (event.type === "task.status_updated") {
        if (event.payload.status === "running") this.runtime.runningTaskIds.add(event.taskId);
        else this.runtime.runningTaskIds.delete(event.taskId);
      }
      this.routeEvent(event);
      if (event.type === "task.removed") this.clearTaskRuntimeState(event.taskId);
    } catch {
      // 状态通知字段漂移时沿用统一丢弃诊断，不影响后续 JSONL 帧。
      warnDroppedCodexNotification(
        this.logger,
        this.project.id,
        "invalid_notification",
        method,
        params,
      );
      return true;
    }
    return true;
  }

  public constructor(
    client: CodexRpcClient,
    project: AgentTaskScope,
    options: { logger?: CodexProviderLogger; subscribeRpc?: boolean } = {},
  ) {
    this.client = client;
    this.logger = options.logger ?? DEFAULT_PROVIDER_LOGGER;
    this.project = project;
    this.pendingLifecycle = new PendingRequestLifecycle({
      publish: (event) => {
        this.routeEvent(event);
      },
      respond: (id, result) => {
        return this.client.respondToServerRequest(id, result);
      },
    });
    if (options.subscribeRpc ?? true) {
      this.client.onNotification((notification) => {
        this.receiveNotification(notification.method, notification.params);
      });
      this.client.onServerRequest((request) => {
        this.receiveServerRequest(request);
      });
    }
  }

  public getCapabilities(): Promise<AgentCapabilities> {
    return Promise.resolve({
      feedback: { upload: true },
      provider: "codex",
      skills: { list: true, use: true },
      tasks: { fork: true, list: true, read: true, start: true },
      turns: {
        compact: true,
        interrupt: true,
        review: true,
        start: true,
        steer: true,
      },
    });
  }

  public async releaseProject(): Promise<void> {
    await releaseCodexProjectThreads(this.client, this.logger, this.project.id, [
      ...this.runtime.projectTaskIds,
    ]);
    // Project 销毁后同步切断所有本地状态，避免定时器和监听器继续持有 Provider。
    this.eventListenersIncludingEphemeral.clear();
    this.eventListeners.clear();
    this.historicalAttachments.dispose();
    this.pendingLifecycle.clear();
    this.runtime.clear();
    this.skillsById.clear();
  }

  public async readSandboxMode(): Promise<AgentSandboxMode> {
    const response = expectRecord(
      await this.client.request("config/read", { cwd: this.project.rootPath }),
      "config/read response",
    );
    const config = expectRecord(response["config"], "config/read config");
    return mapSandboxMode(config["sandbox_mode"]);
  }

  public async archiveTask(taskId: string): Promise<void> {
    this.assertKnownProjectTask(taskId);
    await taskArchive.archiveCodexTask(this.client, taskId);
  }

  public async deleteTask(taskId: string): Promise<void> {
    this.assertKnownProjectTask(taskId);
    await taskArchive.deleteCodexTask(this.client, taskId);
    // 永久删除成功后立即释放所有本地 Task 状态，不能等待可选通知。
    this.clearTaskRuntimeState(taskId);
  }

  public async unarchiveTask(taskId: string): Promise<AgentTask> {
    this.assertKnownProjectTask(taskId);
    const task = await taskArchive.unarchiveCodexTask(this.client, taskId, (thread) =>
      mapAgentTask(thread, this.project),
    );
    this.runtime.projectTaskIds.add(task.id);
    return task;
  }

  public async compactTask(taskId: string): Promise<void> {
    this.assertKnownProjectTask(taskId);
    expectRecord(
      await this.client.request("thread/compact/start", { threadId: taskId }),
      "thread/compact/start response",
    );
  }

  public async forkTask(taskId: string, lastTurnId?: string): Promise<AgentTask> {
    this.assertKnownProjectTask(taskId);
    const response = expectRecord(
      await this.client.request("thread/fork", {
        ...(lastTurnId === undefined ? {} : { lastTurnId }),
        // Fork 必须使用当前 Project 的完整运行时根，不能继承旧 Thread 的单根配置。
        runtimeWorkspaceRoots: [...this.project.runtimeWorkspaceRoots],
        threadId: taskId,
      }),
      "thread/fork response",
    );
    const task = await mapAgentTask(
      expectRecord(response["thread"], "thread/fork thread"),
      this.project,
    );
    // Fork 成功后立即接受新 Task 的实时通知与后续 Mutation。
    this.runtime.projectTaskIds.add(task.id);
    this.runtime.resumedTaskIds.add(task.id);
    return task;
  }

  public async renameTask(taskId: string, title: string): Promise<void> {
    this.assertKnownProjectTask(taskId);
    expectRecord(
      await this.client.request("thread/name/set", { name: title, threadId: taskId }),
      "thread/name/set response",
    );
  }

  public async pinTask(taskId: string, pinned: boolean): Promise<AgentTask> {
    this.assertKnownProjectTask(taskId);
    expectRecord(
      await this.client.request("thread/section/move", {
        sectionId: pinned ? CODEX_PINNED_THREAD_SECTION_ID : null,
        threadId: taskId,
      }),
      "thread/section/move response",
    );
    const response = expectRecord(
      await this.client.request("thread/read", { includeTurns: false, threadId: taskId }),
      "thread/read response",
    );
    const task = await mapAgentTask(
      expectRecord(response["thread"], "thread/read thread"),
      this.project,
    );
    if (task.id !== taskId) {
      throw new CodexProtocolMappingError("thread/read returned a different thread");
    }
    if (task.pinned !== pinned) {
      throw new CodexProtocolMappingError("thread/read returned a different pinned state");
    }
    return task;
  }

  public async listMcpServers(taskId: string): Promise<AgentMcpServerPage> {
    this.assertKnownProjectTask(taskId);
    // MCP 状态绑定已加载的 Thread，历史 Task 必须先恢复再读取任务级服务。
    await this.resumeTask(taskId);
    return listCodexMcpServers(this.client, this.runtime, taskId);
  }

  public async reloadMcpServers(taskId: string): Promise<AgentMcpServerPage> {
    this.assertKnownProjectTask(taskId);
    await this.resumeTask(taskId);
    return reloadCodexMcpServers(this.client, this.runtime, taskId);
  }

  public async listModels(): Promise<AgentModelPage> {
    const data: AgentModelPage["data"][number][] = [];
    const visitedCursors = new Set<string>();
    let cursor: string | undefined;

    do {
      const response = expectRecord(
        await this.client.request("model/list", {
          ...(cursor === undefined ? {} : { cursor }),
          includeHidden: false,
          limit: 100,
        }),
        "model/list response",
      );
      if (!Array.isArray(response["data"])) {
        throw new CodexProtocolMappingError("model/list data must be an array");
      }
      for (const value of response["data"]) {
        const model = mapAgentModel(value);
        if (model !== undefined) {
          data.push(model);
        }
      }
      const nextCursor = response["nextCursor"];
      if (nextCursor !== null && typeof nextCursor !== "string") {
        throw new CodexProtocolMappingError("model/list nextCursor must be a string or null");
      }
      if (typeof nextCursor === "string") {
        if (visitedCursors.has(nextCursor)) {
          throw new CodexProtocolMappingError("model/list returned a repeated cursor");
        }
        visitedCursors.add(nextCursor);
        cursor = nextCursor;
      } else {
        cursor = undefined;
      }
    } while (cursor !== undefined);

    return { data, nextCursor: null };
  }

  public async listSkills(): Promise<AgentSkillPage> {
    const response = expectRecord(
      await this.client.request("skills/list", {
        cwds: [this.project.rootPath],
        forceReload: false,
      }),
      "skills/list response",
    );
    if (!Array.isArray(response["data"])) {
      throw new CodexProtocolMappingError("skills/list data must be an array");
    }
    let projectEntry: Record<string, unknown> | undefined;
    for (const value of response["data"]) {
      const entry = expectRecord(value, "skills/list entry");
      if (
        await isSameCanonicalPath(
          expectString(entry["cwd"], "skills/list cwd"),
          this.project.rootPath,
        )
      ) {
        projectEntry = entry;
        break;
      }
    }
    if (projectEntry === undefined || !Array.isArray(projectEntry["skills"])) {
      throw new CodexProtocolMappingError("skills/list did not return the active project");
    }

    const skills = projectEntry["skills"].map(mapCodexSkill).filter((skill) => skill.enabled);
    this.skillsById.clear();
    for (const skill of skills) {
      this.skillsById.set(skill.id, skill);
    }
    return {
      data: skills.map(({ description, displayName, id, name, scope }) => ({
        description,
        displayName,
        id,
        name,
        scope,
      })),
      nextCursor: null,
    };
  }
}
