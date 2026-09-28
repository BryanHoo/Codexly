import type { CodexRpcClient } from "./codex-rpc-client.js";
import type { CodexTaskTitles } from "./task-titles.js";
import type {
  AgentTaskScope,
  AgentProviderEvent,
  AgentProviderEventListener,
  AgentProviderTaskSnapshot,
} from "@codexly/core";
import type {
  AgentCapabilities,
  AgentMessageAttachment,
  AgentMcpServerPage,
  AgentModelPage,
  AgentSandboxMode,
  AgentSkillPage,
  AgentTask,
} from "@codexly/protocol";
import { RpcResponseError, type RpcServerRequest } from "./jsonl-rpc-client.js";
import { CodexHistoricalAttachmentStore } from "./historical-attachment-store.js";
import type { HistoricalAttachmentStore } from "./persistent-historical-attachment-store.js";
import { CodexThreadAttachmentService } from "./thread-attachment-service.js";
import { ForkTaskRegistry } from "./fork-task-registry.js";
import { PendingRequestLifecycle } from "./pending-request-lifecycle.js";
import { listCodexMcpServers, reloadCodexMcpServers } from "./agent-provider-mcp.js";
import { TaskRuntimeState } from "./task-runtime-state.js";
import { isSameCanonicalPath } from "./canonical-path-identity.js";
import { mapCodexProjectStateNotification } from "./agent-provider-notifications.js";
import { warnDroppedCodexNotification } from "./agent-provider-diagnostics.js";
import { DEFAULT_PROVIDER_LOGGER, type CodexProviderLogger } from "./agent-provider-logger.js";
import * as taskArchive from "./agent-provider-task-archive.js";
import { releaseCodexProjectThreads } from "./thread-unsubscribe.js";
import {
  CodexProtocolMappingError,
  CODEX_THREAD_CONFIG,
  CODEX_PINNED_THREAD_SECTION_ID,
  type CodexSkill,
  expectRecord,
  expectString,
  mapAgentModel,
  mapAgentTask,
  mapCodexSkill,
  mapSandboxMode,
} from "./codex-protocol-mapping.js";

export {
  CodexProtocolMappingError,
  CODEX_PINNED_THREAD_SECTION_ID,
  assertProjectThread,
  isProjectThread,
  mapAgentTask,
} from "./codex-protocol-mapping.js";
export type { CodexRpcClient } from "./codex-rpc-client.js";
export { canonicalPathIdentity, isSameCanonicalPath } from "./canonical-path-identity.js";

export interface CreateCodexRuntimeProviderOptions {
  codexHome?: string;
  client: CodexRpcClient;
  fetch?: typeof globalThis.fetch;
  modelCatalogRuntimeFactory?: () => Promise<{
    client: CodexRpcClient;
    close(): Promise<void>;
  }>;
  readTaskTitleModel?: () => Promise<string>;
  logger?: CodexProviderLogger;
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
    goal: null,
    plan: null,
    pendingRequests: [],
    status: "idle",
    turns: [],
    turnsNextCursor: null,
  };
}

export abstract class CodexAgentProviderBase {
  protected readonly client: CodexRpcClient;
  protected readonly taskTitles: CodexTaskTitles | undefined;
  protected readonly eventListenersIncludingEphemeral = new Set<AgentProviderEventListener>();
  protected readonly eventListeners = new Set<AgentProviderEventListener>();
  protected readonly historicalAttachments: HistoricalAttachmentStore;
  protected readonly threadAttachments: CodexThreadAttachmentService | undefined;
  protected readonly forkTasks: ForkTaskRegistry | undefined;
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
      if (event.type === "task.removed") {
        if (method === "thread/deleted") this.threadAttachments?.deleteTask(event.taskId);
        this.clearTaskRuntimeState(event.taskId);
      }
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
    options: {
      attachmentDirectory?: string;
      forkTaskDirectory?: string;
      logger?: CodexProviderLogger;
      subscribeRpc?: boolean;
      taskTitles?: CodexTaskTitles;
    } = {},
  ) {
    this.client = client;
    this.threadAttachments =
      options.attachmentDirectory === undefined
        ? undefined
        : new CodexThreadAttachmentService(client, options.attachmentDirectory);
    this.forkTasks =
      options.forkTaskDirectory === undefined
        ? undefined
        : new ForkTaskRegistry(options.forkTaskDirectory);
    this.historicalAttachments =
      this.threadAttachments?.store ?? new CodexHistoricalAttachmentStore();
    this.taskTitles = options.taskTitles;
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
      goals: { clear: true, read: true, update: true },
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
    await this.taskTitles?.releaseProject(this.project.id);
    await releaseCodexProjectThreads(this.client, this.logger, this.project.id, [
      ...this.runtime.projectTaskIds,
    ]);
    // Project 销毁后同步切断所有本地状态，避免定时器和监听器继续持有 Provider。
    this.eventListenersIncludingEphemeral.clear();
    this.eventListeners.clear();
    if (this.threadAttachments === undefined) this.historicalAttachments.dispose();
    else this.threadAttachments.dispose();
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
    await this.forkTasks?.forget(this.project.id, taskId);
    this.threadAttachments?.deleteTask(taskId);
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
        config: CODEX_THREAD_CONFIG,
        // 仅返回元数据并覆盖完整运行时根；历史统一分页读取，避免单个 JSONL 帧过大。
        excludeTurns: true,
        ...(lastTurnId === undefined ? {} : { lastTurnId }),
        ...(this.project.kind === "project"
          ? {
              runtimeWorkspaceRoots: this.runtime.workspaceRootsForTask(
                taskId,
                this.project.runtimeWorkspaceRoots,
              ),
            }
          : {}),
        threadId: taskId,
      }),
      "thread/fork response",
    );
    let thread = expectRecord(response["thread"], "thread/fork thread");
    if (this.project.kind === "project" && thread["projectId"] === null) {
      const forkId = expectString(thread["id"], "thread/fork thread id");
      // 原生 fork 会创建 rollout，但不会继承项目归属；先持久绑定再暴露分支。
      const assignment = expectRecord(
        await this.client.request("thread/metadata/update", {
          projectId: this.project.id,
          threadId: forkId,
        }),
        "thread/metadata/update response",
      );
      thread = expectRecord(assignment["thread"], "thread/metadata/update thread");
      if (thread["id"] !== forkId) {
        throw new CodexProtocolMappingError("thread/metadata/update returned a different thread");
      }
    }
    const task = await mapAgentTask(thread, this.project);
    if (task.workspacePath !== undefined)
      this.runtime.taskWorkspacePaths.set(task.id, task.workspacePath);
    await this.forkTasks?.record(this.project.id, task.id);
    // Fork 成功后立即接受新 Task 的实时通知与后续 Mutation。
    this.runtime.projectTaskIds.add(task.id);
    this.runtime.resumedTaskIds.add(task.id);
    // 上游列表可能尚未收录分支；保留已确认的元数据，避免未发送消息时刷新丢失任务。
    this.runtime.unmaterializedTasks.set(task.id, task);
    return task;
  }

  public async renameTask(taskId: string, title: string): Promise<void> {
    this.assertKnownProjectTask(taskId);
    const rename = async () => {
      expectRecord(
        await this.client.request("thread/name/set", { name: title, threadId: taskId }),
        "thread/name/set response",
      );
    };
    if (this.taskTitles === undefined) await rename();
    else await this.taskTitles.mutate(taskId, rename);
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
    return listCodexMcpServers(this.client, taskId);
  }

  public async reloadMcpServers(taskId: string): Promise<AgentMcpServerPage> {
    this.assertKnownProjectTask(taskId);
    await this.resumeTask(taskId);
    return reloadCodexMcpServers(this.client, taskId);
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
