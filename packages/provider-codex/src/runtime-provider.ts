import { resolve } from "node:path";
import type {
  AgentProvider,
  AgentRuntimeDefaultSettings,
  AgentRuntimeProvider,
  AgentTaskScope,
} from "@codexly/core";
import type {
  AgentCapabilities,
  AgentProviderConnectionMutationResponse,
  AgentProviderConnectionStatus,
  AgentModelPage,
  ConfigureCustomProviderRequest,
  ConfigureCustomProviderResponse,
  Project,
  StartOfficialProviderLoginResponse,
} from "@codexly/protocol";
import { TEMPORARY_TASK_SCOPE_ID } from "@codexly/protocol";
import { RuntimeOwnerRegistry, isSameResolvedPath } from "./runtime-owner-registry.js";
import { CodexProtocolMappingError } from "./codex-protocol-mapping.js";

import { CodexAgentProvider } from "./agent-provider-runtime.js";
import type { CodexRpcClient, CreateCodexRuntimeProviderOptions } from "./agent-provider-base.js";
import { DEFAULT_PROVIDER_LOGGER, type CodexProviderLogger } from "./agent-provider-logger.js";
import { readReviewWorkerThread, readTaskId } from "./agent-provider-notifications.js";
import { CodexProviderConnectionService } from "./provider-connection.js";
import { CodexRuntimeProjectProvider } from "./runtime-project-provider.js";
import { CodexFuzzyFileSearchService } from "./fuzzy-file-search.js";
import { CodexGitMetadataWatchService } from "./git-metadata-watch.js";

function optionalNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalApprovalPolicy(value: unknown): AgentRuntimeDefaultSettings["approvalPolicy"] {
  if (value === "on-request" || value === "never") {
    return value;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("granular" in record)) {
    return undefined;
  }
  const granular = record["granular"];
  if (typeof granular !== "object" || granular === null || Array.isArray(granular)) {
    return undefined;
  }
  const fields = granular as Record<string, unknown>;
  const knownFields = new Set([
    "mcp_elicitations",
    "request_permissions",
    "rules",
    "sandbox_approval",
    "skill_approval",
  ]);
  if (
    Object.keys(fields).some((key) => !knownFields.has(key)) ||
    typeof fields["mcp_elicitations"] !== "boolean" ||
    typeof fields["rules"] !== "boolean" ||
    typeof fields["sandbox_approval"] !== "boolean" ||
    (fields["request_permissions"] !== undefined &&
      typeof fields["request_permissions"] !== "boolean") ||
    (fields["skill_approval"] !== undefined && typeof fields["skill_approval"] !== "boolean")
  ) {
    return undefined;
  }
  return {
    granular: {
      mcp_elicitations: fields["mcp_elicitations"],
      request_permissions: fields["request_permissions"] ?? false,
      rules: fields["rules"],
      sandbox_approval: fields["sandbox_approval"],
      skill_approval: fields["skill_approval"] ?? false,
    },
  };
}

function optionalSandboxMode(value: unknown): AgentRuntimeDefaultSettings["sandboxMode"] {
  return value === "read-only" || value === "workspace-write" || value === "danger-full-access"
    ? value
    : undefined;
}

export class CodexRuntimeProvider implements AgentRuntimeProvider {
  public readonly fileSearch: CodexFuzzyFileSearchService;
  readonly #client: CodexRpcClient;
  readonly #logger: CodexProviderLogger;
  readonly #gitMetadataWatch: CodexGitMetadataWatchService;
  readonly #providerConnection: CodexProviderConnectionService;
  readonly #owners = new RuntimeOwnerRegistry();
  readonly #projects = new Map<string, AgentTaskScope>();
  readonly #projectProviders = new Map<string, CodexRuntimeProjectProvider>();
  readonly #rawProviders = new Map<string, CodexAgentProvider>();
  readonly #reviewWorkerOwners = new Map<
    string,
    Readonly<{ parentTaskId: string; projectId: string }>
  >();

  public constructor(
    client: CodexRpcClient,
    logger: CodexProviderLogger = DEFAULT_PROVIDER_LOGGER,
    options: Readonly<{ fetch?: typeof globalThis.fetch }> = {},
  ) {
    this.#client = client;
    this.#logger = logger;
    this.#providerConnection = new CodexProviderConnectionService(client, options);
    this.fileSearch = new CodexFuzzyFileSearchService(client);
    this.#gitMetadataWatch = new CodexGitMetadataWatchService(client, {
      logger,
      onChanged: (projectId, rootPath) => {
        this.#rawProviders.get(projectId)?.publishProjectGitMetadataChanged(rootPath);
      },
    });
    client.onNotification((notification) => {
      // 所有 App Server 通知保持单订阅，再按能力分发给内部服务。
      this.#gitMetadataWatch.receiveNotification(notification.method, notification.params);
      if (notification.method === "fs/changed") return;
      this.fileSearch.receiveNotification(notification.method, notification.params);
      this.#providerConnection.receiveNotification(notification.method, notification.params);
      if (notification.method === "skills/changed") {
        for (const provider of this.#rawProviders.values()) {
          provider.receiveNotification(notification.method, notification.params);
        }
        return;
      }
      const taskId = readTaskId(notification.params);
      if (taskId === undefined) {
        return;
      }
      const reviewWorker =
        notification.method === "thread/started"
          ? readReviewWorkerThread(notification.params)
          : undefined;
      if (reviewWorker !== undefined) {
        const projectId = this.#owners.projectIdForTask(reviewWorker.parentTaskId);
        if (projectId !== undefined) {
          // 子 Thread 不进入 Task 列表，只继承父 Task 的事件路由归属。
          this.#reviewWorkerOwners.set(reviewWorker.workerTaskId, {
            parentTaskId: reviewWorker.parentTaskId,
            projectId,
          });
          this.#rawProviders
            .get(projectId)
            ?.receiveNotification(notification.method, notification.params);
        }
        return;
      }
      const workerOwner = this.#reviewWorkerOwners.get(taskId);
      const projectId = this.#owners.projectIdForTask(taskId) ?? workerOwner?.projectId;
      this.#rawProviders
        .get(projectId ?? "")
        ?.receiveNotification(notification.method, notification.params);
      if (
        projectId !== undefined &&
        (notification.method === "thread/archived" || notification.method === "thread/deleted")
      ) {
        const project = this.#projects.get(projectId);
        if (project !== undefined) this.#owners.releaseTask(project, taskId);
      }
      if (workerOwner !== undefined && notification.method === "turn/completed") {
        this.#reviewWorkerOwners.delete(taskId);
      }
    });
    client.onServerRequest((request) => {
      const taskId = readTaskId(request.params);
      const provider =
        taskId === undefined
          ? undefined
          : this.#rawProviders.get(this.#owners.projectIdForTask(taskId) ?? "");
      if (provider !== undefined) {
        provider.receiveServerRequest(request);
        return;
      }
      void client
        .rejectServerRequest(request.id, {
          code: -32602,
          data: { method: request.method },
          message: "Task project is unknown",
        })
        .catch(() => undefined);
    });
  }

  public cancelProviderLogin(loginId: string): Promise<AgentProviderConnectionMutationResponse> {
    return this.#providerConnection.cancelLogin(loginId);
  }

  public configureCustomProvider(
    input: ConfigureCustomProviderRequest,
  ): Promise<ConfigureCustomProviderResponse> {
    return this.#providerConnection.configureCustom(input);
  }

  public forProject(project: Project): AgentProvider {
    const primaryRoot = project.roots[0];
    if (primaryRoot === undefined) {
      throw new CodexProtocolMappingError("Codex project roots must contain a primary root");
    }
    return this.#forScope({
      id: project.id,
      kind: "project",
      rootPath: primaryRoot.path,
      runtimeWorkspaceRoots: project.roots.map((root) => root.path),
    });
  }

  public forTemporary(rootPath: string): AgentProvider {
    return this.#forScope({
      id: TEMPORARY_TASK_SCOPE_ID,
      kind: "temporary",
      rootPath,
      runtimeWorkspaceRoots: [rootPath],
    });
  }

  #forScope(project: AgentTaskScope): AgentProvider {
    const current = this.#projectProviders.get(project.id);
    if (current !== undefined) {
      const registeredProject = this.#projects.get(project.id);
      if (
        registeredProject === undefined ||
        !isSameResolvedPath(registeredProject.rootPath, project.rootPath)
      ) {
        throw new CodexProtocolMappingError("Codex project identity belongs to another cwd");
      }
      return current;
    }
    const rawProvider = new CodexAgentProvider(this.#client, project, {
      logger: this.#logger,
      subscribeRpc: false,
    });
    const provider = new CodexRuntimeProjectProvider(this, rawProvider, project);
    this.#rawProviders.set(project.id, rawProvider);
    this.#projectProviders.set(project.id, provider);
    this.#projects.set(project.id, project);
    if (project.kind === "project") {
      void this.#gitMetadataWatch.watchProject(project);
    }
    return provider;
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

  public listModels(): Promise<AgentModelPage> {
    const firstProvider = this.#projectProviders.values().next().value;
    if (firstProvider !== undefined) {
      return firstProvider.listModels();
    }
    const runtimeProject: AgentTaskScope = {
      id: "runtime",
      kind: "project",
      rootPath: resolve("/"),
      runtimeWorkspaceRoots: [resolve("/")],
    };
    return new CodexAgentProvider(this.#client, runtimeProject, {
      logger: this.#logger,
      subscribeRpc: false,
    }).listModels();
  }

  public logoutProvider(): Promise<AgentProviderConnectionMutationResponse> {
    return this.#providerConnection.logout();
  }

  public async readDefaultSettings(): Promise<AgentRuntimeDefaultSettings> {
    const config = await this.#providerConnection.readConfig();
    const approvalsReviewer = config["approvals_reviewer"];
    const approvalPolicy = optionalApprovalPolicy(config["approval_policy"]);

    // 审批策略与审核方是独立配置；never 下审核方保留但不会收到交互请求。
    const approvalDefaults: AgentRuntimeDefaultSettings = {
      ...(approvalPolicy === undefined ? {} : { approvalPolicy }),
      ...(approvalsReviewer === "user" || approvalsReviewer === "auto_review"
        ? { approvalsReviewer }
        : {}),
    };
    const model = optionalNonEmptyString(config["model"]);
    const reasoningEffort = optionalNonEmptyString(config["model_reasoning_effort"]);
    const sandboxMode = optionalSandboxMode(config["sandbox_mode"]);

    return {
      ...approvalDefaults,
      ...(model === undefined ? {} : { model }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(sandboxMode === undefined ? {} : { sandboxMode }),
    };
  }

  public readProviderConnection(): Promise<AgentProviderConnectionStatus> {
    return this.#providerConnection.readStatus();
  }

  public async releaseProject(projectId: string, expectedProvider?: AgentProvider): Promise<void> {
    const projectProvider = this.#projectProviders.get(projectId);
    if (expectedProvider !== undefined && projectProvider !== expectedProvider) {
      return;
    }
    const provider = this.#rawProviders.get(projectId);
    // 先移除路由和 Owner，再清空 Provider 内部状态，后续 RPC 无法回流到已删除 Project。
    this.#projects.delete(projectId);
    this.#projectProviders.delete(projectId);
    this.#rawProviders.delete(projectId);
    this.#owners.releaseProject(projectId);
    for (const [workerTaskId, owner] of this.#reviewWorkerOwners) {
      if (owner.projectId === projectId) {
        this.#reviewWorkerOwners.delete(workerTaskId);
      }
    }
    // 释放入口同步捕获各自旧实例，后续 await 不得再按 projectId 命中新代次资源。
    const releases = [
      this.#gitMetadataWatch.releaseProject(projectId),
      provider?.releaseProject() ?? Promise.resolve(),
      this.fileSearch.releaseProject(projectId),
    ];
    await Promise.all(releases);
  }

  public startOfficialProviderLogin(): Promise<StartOfficialProviderLoginResponse> {
    return this.#providerConnection.startOfficialLogin();
  }

  public beginTaskRead(project: AgentTaskScope, taskId: string): boolean {
    return this.#owners.beginTaskRead(project, taskId);
  }

  public claimTask(project: AgentTaskScope, taskId: string): void {
    this.#owners.claimTask(project, taskId);
  }

  public assertTaskOwner(project: AgentTaskScope, taskId: string): void {
    this.#owners.assertTaskOwner(project, taskId);
  }

  public isTaskOwner(project: AgentTaskScope, taskId: string): boolean {
    return this.#owners.isTaskOwner(project, taskId);
  }

  public releaseTask(project: AgentTaskScope, taskId: string): void {
    this.#owners.releaseTask(project, taskId);
    for (const [workerTaskId, owner] of this.#reviewWorkerOwners) {
      if (owner.parentTaskId === taskId) {
        this.#reviewWorkerOwners.delete(workerTaskId);
      }
    }
  }

  public releaseProvisionalTask(project: AgentTaskScope, taskId: string): void {
    this.#owners.releaseProvisionalTask(project, taskId);
  }
}

export function createCodexRuntimeProvider(
  options: CreateCodexRuntimeProviderOptions,
): CodexRuntimeProvider {
  return new CodexRuntimeProvider(options.client, options.logger, {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
}
