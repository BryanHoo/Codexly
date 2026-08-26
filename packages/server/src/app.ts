import {
  DEFAULT_COMMIT_MESSAGE_MODEL,
  type AgentGlobalSettings,
  type AgentModel,
  type AgentProjectDefaults,
  type AgentTaskSettings,
} from "@codexly/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import { AttachmentStore } from "./attachment-store.js";
import { commitSelectedProjectChanges } from "./git-commit.js";
import { readProjectGitCommitFileDiff, readProjectGitCommitFiles } from "./git-commit-review.js";
import { buildCommitMessagePrompt } from "./git-commit-message.js";
import * as gitBranch from "./git-branch.js";
import * as gitWorktree from "./git-worktree.js";
import { readProjectGitHistory } from "./git-history.js";
import { readProjectGitStatus as readGitProjectStatus } from "./git-working-tree.js";
import { readHostFileDirectory, resolveHostAttachment } from "./host-file-browser.js";
import { createIdempotencyRunner } from "./idempotency-runner.js";
import { readProjectFileTree } from "./project-file-tree.js";
import { deleteProjectFile, renameProjectFile } from "./project-file-mutations.js";
import { readProjectImageFile } from "./project-image-file.js";
import { readProjectSourceFile } from "./project-source-file.js";
import { createProviderTurnInputResolver } from "./provider-turn-input-resolver.js";
import { createProjectOpenService } from "./project-open.js";
import { createProjectRuntimeContext } from "./project-runtime-context.js";
import {
  DEFAULT_PROJECT_RUNTIME_CLEANUP_INTERVAL_MS,
  DEFAULT_PROJECT_RUNTIME_IDLE_TTL_MS,
  ProjectRuntimeIdleReaper,
} from "./project-runtime-idle-reaper.js";
import { ProjectRuntimeLifecycleLock } from "./project-runtime-lifecycle-lock.js";
import { PersistentTaskQueue } from "./persistent-task-queue.js";
import { createMemoryTaskQueueRepository } from "./memory-task-queue-repository.js";
import { readProjectDirectory, resolveProjectDirectory } from "./project-directory-browser.js";
import type {
  ProjectContextResolver,
  ProjectRuntimeContext,
  ServerRouteContext,
  TaskStartRecovery,
} from "./routes/context.js";
import { registerEventRoutes } from "./routes/event-routes.js";
import { registerAccessRoutes } from "./routes/access-routes.js";
import { registerProjectRoutes } from "./routes/project-routes.js";
import { registerProviderConnectionRoutes } from "./routes/provider-connection-routes.js";
import { registerPetRoutes } from "./routes/pet-routes.js";
import { registerRuntimeRoutes } from "./routes/runtime-routes.js";
import { registerTaskRoutes } from "./routes/task-routes.js";
import { registerTurnRoutes } from "./routes/turn-routes.js";
import { registerQueueRoutes } from "./routes/queue-routes.js";
import { configureServerDelivery } from "./server-delivery.js";
import type { CreateCodexlyServerOptions } from "./server-options.js";
import { runSingleFlight } from "./single-flight.js";
import { resolveTaskScope } from "./task-scope.js";
import { rewriteTemporaryTaskUrl } from "./temporary-task-routing.js";
import {
  DEFAULT_HANDLER_TIMEOUT_MS,
  DEFAULT_IDEMPOTENCY_CACHE_SIZE,
  DEFAULT_IDEMPOTENCY_TTL_MS,
  DEFAULT_MODEL_CATALOG_CACHE_MAX_BYTES,
  DEFAULT_MODEL_CATALOG_CACHE_TTL_MS,
  MULTIPART_ENVELOPE_BYTES,
  CodexlyLogController,
  ModelCatalogCache,
  assertCommitSelection,
  assertValidProjectDefaults,
  createModelCatalogLoader,
  fingerprintPayload,
  generateCommitMessageWithCodex,
  maximumAttachmentBytes,
  resolveProjectDefaults,
  taskFromSnapshot,
  toGitCommitHttpError,
  toPendingRequestHttpError,
} from "./server-runtime.js";
export type { CreateCodexlyServerOptions } from "./server-options.js";
export async function createCodexlyServer(
  options: CreateCodexlyServerOptions,
): Promise<FastifyInstance> {
  const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  const logger =
    options.loggerEnabled === false
      ? false
      : {
          // CLI 运行时只向终端输出警告和错误。
          level: "warn",
          // 即使后续扩展请求 Serializer，也不能让认证字段进入结构化日志。
          redact: {
            censor: "[Redacted]",
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
            ],
          },
          ...(options.logDestination === undefined ? {} : { stream: options.logDestination }),
        };
  const app = Fastify({
    handlerTimeout: 0,
    logController: new CodexlyLogController(),
    logger,
    rewriteUrl: (request) => rewriteTemporaryTaskUrl(request.url ?? "/"),
  });
  app.addHook("onRoute", (routeOptions) => {
    // WebSocket 是显式长连接；普通 HTTP 路由使用 Fastify 原生 request.signal 协作取消。
    if (handlerTimeoutMs > 0 && routeOptions.websocket !== true) {
      routeOptions.handlerTimeout ??= handlerTimeoutMs;
    }
  });
  const readProjectGitStatus = options.readProjectGitStatus ?? readGitProjectStatus;
  const commitProjectChanges = options.commitProjectChanges ?? commitSelectedProjectChanges;
  const readFileTree = options.readProjectFileTree ?? readProjectFileTree;
  const nativeFileSearch = options.provider.fileSearch;
  const searchProjectFiles =
    options.searchProjectFiles ??
    ((input) => {
      if (nativeFileSearch === undefined) {
        return Promise.reject(new Error("Provider file search is unavailable"));
      }
      return nativeFileSearch.search(input);
    });
  const stopProjectFileSearch =
    options.stopProjectFileSearch ??
    ((projectId, sessionId) => {
      if (nativeFileSearch === undefined) {
        return Promise.reject(new Error("Provider file search is unavailable"));
      }
      return nativeFileSearch.stop(projectId, sessionId);
    });
  const readImageFile = options.readProjectImageFile ?? readProjectImageFile;
  const readSourceFile = options.readProjectSourceFile ?? readProjectSourceFile;
  const projectOpenService = options.projectOpenService ?? createProjectOpenService();
  const attachmentStore = new AttachmentStore();
  const resolveProviderTurnInput = createProviderTurnInputResolver(attachmentStore);
  const capabilities = await options.provider.getCapabilities();
  const modelCatalogCacheMaxBytes =
    options.modelCatalogCacheMaxBytes ?? DEFAULT_MODEL_CATALOG_CACHE_MAX_BYTES;
  const modelCatalogCacheTtlMs =
    options.modelCatalogCacheTtlMs ?? DEFAULT_MODEL_CATALOG_CACHE_TTL_MS;
  if (!Number.isInteger(modelCatalogCacheMaxBytes) || modelCatalogCacheMaxBytes <= 0) {
    throw new RangeError("Model catalog cache capacity must be a positive integer");
  }
  if (!Number.isFinite(modelCatalogCacheTtlMs) || modelCatalogCacheTtlMs <= 0) {
    throw new RangeError("Model catalog cache TTL must be a positive number");
  }
  const modelCatalogCache = new ModelCatalogCache(
    createModelCatalogLoader(options.provider, options.providerConnectionRepository),
    { maxBytes: modelCatalogCacheMaxBytes, ttlMs: modelCatalogCacheTtlMs },
  );
  const projectContexts = new Map<string, ProjectRuntimeContext>();
  const projectInitializations = new Map<string, Promise<ProjectRuntimeContext | undefined>>();
  const projectRuntimeLifecycleLock = new ProjectRuntimeLifecycleLock();
  const getProjectContext: ProjectContextResolver = async (projectId) => {
    const existing = projectContexts.get(projectId);
    if (existing !== undefined) {
      projectRuntimeIdleReaper.touch(projectId);
      return existing;
    }
    return runSingleFlight(projectInitializations, projectId, () =>
      projectRuntimeLifecycleLock.run(projectId, async () => {
        const concurrentContext = projectContexts.get(projectId);
        if (concurrentContext !== undefined) {
          projectRuntimeIdleReaper.touch(projectId);
          return concurrentContext;
        }
        // 已激活 Runtime 的身份由创建时校验；仅缓存未命中时访问持久层。
        const resolved = await resolveTaskScope(projectId, options);
        if (resolved === undefined) {
          return undefined;
        }
        const context = createProjectRuntimeContext({
          attachmentStore,
          ...(options.eventBufferSize === undefined
            ? {}
            : { eventBufferSize: options.eventBufferSize }),
          eventProvider: capabilities.provider,
          ...(options.eventSessionId === undefined
            ? {}
            : { eventSessionId: options.eventSessionId }),
          onActivity: () => {
            projectRuntimeIdleReaper.touch(projectId);
          },
          onAttachmentReleaseError: (error) => {
            app.log.warn({ error }, "Failed to release turn attachments");
          },
          onTurnCompleted: (runtime) => taskQueue.startNext(runtime),
          provider: resolved.provider,
          scope: resolved.scope,
        });
        projectContexts.set(projectId, context);
        projectRuntimeIdleReaper.touch(projectId);
        return context;
      }),
    );
  };
  const releaseProjectContext = async (projectId: string, preserveQueuedAttachments = false) =>
    projectRuntimeLifecycleLock.run(projectId, async () => {
      projectRuntimeIdleReaper.forget(projectId);
      const context = projectContexts.get(projectId);
      if (context !== undefined) {
        // 在锁内摘除并完整释放旧代次，禁止同 ID Runtime 提前重建。
        context.unsubscribe();
        context.eventStream.close();
        projectContexts.delete(projectId);
      }
      await Promise.all([
        options.provider.releaseProject(projectId, context?.provider),
        preserveQueuedAttachments
          ? attachmentStore.releaseProjectRuntime(projectId)
          : attachmentStore.releaseProject(projectId),
      ]);
    });
  const projectRuntimeIdleReaper = new ProjectRuntimeIdleReaper({
    cleanupIntervalMs:
      options.projectRuntimeCleanupIntervalMs ?? DEFAULT_PROJECT_RUNTIME_CLEANUP_INTERVAL_MS,
    contexts: projectContexts,
    idleTtlMs: options.projectRuntimeIdleTtlMs ?? DEFAULT_PROJECT_RUNTIME_IDLE_TTL_MS,
    onReleaseError: (error, projectId) => {
      app.log.warn({ error, projectId }, "Failed to release idle Project runtime");
    },
    release: (projectId) => releaseProjectContext(projectId, true),
  });
  const listModels = async (): Promise<readonly AgentModel[]> =>
    (await modelCatalogCache.read()).data;
  const readEffectiveGlobalSettings = async (
    models?: readonly AgentModel[],
  ): Promise<AgentGlobalSettings> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readGlobalSettings();
    // 仅在 Codexly 尚无全局记录时读取 Codex 用户配置，持久化后不再被外部变化覆盖。
    const runtimeDefaults =
      stored === undefined ? await options.provider.readDefaultSettings() : {};
    const requestedDefaults = stored ?? runtimeDefaults;
    const effectiveModel = resolveProjectDefaults(
      catalog,
      requestedDefaults,
      requestedDefaults.sandboxMode ?? "workspace-write",
    );
    const effectiveCommitModel = resolveProjectDefaults(
      catalog,
      {
        model: stored?.commitMessageModel ?? DEFAULT_COMMIT_MESSAGE_MODEL,
        sandboxMode: "read-only",
      },
      "read-only",
    );
    const approvalPolicy = requestedDefaults.approvalPolicy ?? "on-request";
    const approvalsReviewer = requestedDefaults.approvalsReviewer ?? "user";
    // 全局记录缺失时只返回运行时默认值；读取不能隐式创建用户配置。
    return {
      approvalPolicy,
      approvalsReviewer,
      commitMessageModel: effectiveCommitModel.model,
      commitMessagePrompt: stored?.commitMessagePrompt ?? "",
      defaultOpenAppId: stored?.defaultOpenAppId ?? null,
      fastMode: stored?.fastMode ?? false,
      followUpBehavior: stored?.followUpBehavior ?? "queue",
      pet: stored?.pet ?? { enabled: false, selectedPetId: null },
      ...effectiveModel,
    };
  };
  const readEffectiveProjectDefaults = async (
    projectId: string,
    models?: readonly AgentModel[],
    globalSettings?: AgentGlobalSettings,
  ): Promise<AgentProjectDefaults> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readProjectDefaults(projectId);
    const inherited = globalSettings ?? (await readEffectiveGlobalSettings(catalog));
    const requested = stored ?? inherited;
    return {
      approvalPolicy: requested.approvalPolicy,
      approvalsReviewer: requested.approvalsReviewer,
      fastMode: requested.fastMode,
      ...resolveProjectDefaults(catalog, requested, inherited.sandboxMode),
    };
  };
  const readInheritedTaskSettings = async (
    projectId: string,
    models?: readonly AgentModel[],
  ): Promise<AgentTaskSettings> => {
    const catalog = models ?? (await listModels());
    const globalSettings = await readEffectiveGlobalSettings(catalog);
    const projectDefaults = await readEffectiveProjectDefaults(projectId, catalog, globalSettings);
    const settings: AgentTaskSettings = {
      approvalPolicy: projectDefaults.approvalPolicy,
      approvalsReviewer: projectDefaults.approvalsReviewer,
      model: projectDefaults.model,
      reasoningEffort: projectDefaults.reasoningEffort,
      sandboxMode: projectDefaults.sandboxMode,
    };
    return settings;
  };
  const readEffectiveTaskSettings = async (
    projectId: string,
    taskId: string,
    models?: readonly AgentModel[],
  ): Promise<AgentTaskSettings> => {
    const catalog = models ?? (await listModels());
    const stored = await options.settingsRepository.readTaskSettings(projectId, taskId);
    if (stored === undefined) {
      return readInheritedTaskSettings(projectId, catalog);
    }
    const effectiveModel = resolveProjectDefaults(catalog, stored, stored.sandboxMode);
    const effective: AgentTaskSettings = {
      approvalPolicy: stored.approvalPolicy,
      approvalsReviewer: stored.approvalsReviewer,
      ...effectiveModel,
    };
    return effective;
  };
  const taskQueue = new PersistentTaskQueue({
    attachmentStore,
    readTaskSettings: readEffectiveTaskSettings,
    repository: options.queueRepository ?? createMemoryTaskQueueRepository(),
    resolveProviderInput: resolveProviderTurnInput,
  });
  const activeGitMutations = new Set<string>();
  const taskStartRecoveries = new Map<string, TaskStartRecovery>();
  const idempotencyCacheSize = options.idempotencyCacheSize ?? DEFAULT_IDEMPOTENCY_CACHE_SIZE;
  const idempotencyTtlMs = options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  const idempotencyRunner = createIdempotencyRunner(idempotencyCacheSize, idempotencyTtlMs);
  const accessService = await configureServerDelivery(app, {
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
    releaseResources: async () => {
      await projectRuntimeIdleReaper.close();
      await Promise.all(
        [...projectContexts.keys()].map((projectId) => releaseProjectContext(projectId)),
      );
      await attachmentStore.dispose();
      activeGitMutations.clear();
      idempotencyRunner.clear();
      modelCatalogCache.clear();
      taskStartRecoveries.clear();
    },
    ...(options.staticRoot === undefined ? {} : { staticRoot: options.staticRoot }),
  });
  const routeContext: ServerRouteContext = {
    ...(accessService === undefined ? {} : { accessService }),
    activeGitMutations,
    assertCommitSelection,
    assertValidProjectDefaults,
    attachmentStore,
    buildCommitMessagePrompt,
    capabilities,
    commitProjectChanges,
    createProjectBranch: options.createProjectBranch ?? gitBranch.createProjectBranch,
    createProjectWorktree: options.createProjectWorktree ?? gitWorktree.createProjectWorktree,
    fingerprintPayload,
    generateCommitMessageWithCodex,
    getProjectContext,
    idempotencyCacheSize,
    installAppUpdate: options.installAppUpdate,
    listModels,
    maximumAttachmentBytes,
    modelCatalogCache,
    multipartEnvelopeBytes: MULTIPART_ENVELOPE_BYTES,
    projectContexts,
    projectOpenService,
    projectRepository: options.projectRepository,
    provider: options.provider,
    petProvider: options.petProvider,
    providerConnectionRepository: options.providerConnectionRepository,
    readAppInfo: options.readAppInfo,
    readEffectiveGlobalSettings,
    readEffectiveProjectDefaults,
    readEffectiveTaskSettings,
    readFileTree,
    deleteProjectFile: options.deleteProjectFile ?? deleteProjectFile,
    renameProjectFile: options.renameProjectFile ?? renameProjectFile,
    searchProjectFiles,
    stopProjectFileSearch,
    readHostFileDirectory: options.readHostFileDirectory ?? readHostFileDirectory,
    readProjectDirectory: options.readProjectDirectory ?? readProjectDirectory,
    readImageFile,
    readInheritedTaskSettings,
    readProjectGitHistory: options.readProjectGitHistory ?? readProjectGitHistory,
    readProjectGitCommitFiles: options.readProjectGitCommitFiles ?? readProjectGitCommitFiles,
    readProjectGitCommitFileDiff:
      options.readProjectGitCommitFileDiff ?? readProjectGitCommitFileDiff,
    readProjectGitStatus,
    readProjectWorktrees: options.readProjectWorktrees ?? gitWorktree.readProjectWorktrees,
    readSourceFile,
    releaseProjectContext,
    resolveProviderTurnInput,
    runIdempotent: idempotencyRunner.run,
    resolveProjectDirectory: options.resolveProjectDirectory ?? resolveProjectDirectory,
    resolveHostAttachment: options.resolveHostAttachment ?? resolveHostAttachment,
    settingsRepository: options.settingsRepository,
    taskFromSnapshot,
    taskQueue,
    taskStartRecoveries,
    switchProjectBranch: options.switchProjectBranch ?? gitBranch.switchProjectBranch,
    resolveProjectWorktree: options.resolveProjectWorktree ?? gitWorktree.resolveProjectWorktree,
    toGitCommitHttpError,
    toPendingRequestHttpError,
  };
  await app.register(registerAccessRoutes, {
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(accessService === undefined ? {} : { service: accessService }),
  });
  await app.register(registerRuntimeRoutes, routeContext);
  await app.register(registerProviderConnectionRoutes, routeContext);
  await app.register(registerPetRoutes, routeContext);
  await app.register(registerProjectRoutes, routeContext);
  await app.register(registerTaskRoutes, routeContext);
  await app.register(registerTurnRoutes, routeContext);
  await app.register(registerQueueRoutes, routeContext);
  await app.register(registerEventRoutes, routeContext);
  await app.ready();
  return app;
}
