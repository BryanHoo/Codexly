import {
  DiagnosticLogBuffer,
  createDiagnosticLogger,
  registerDiagnosticRoutes,
} from "./diagnostics.js";
import { resolveGlobalSettings } from "./global-settings-reader.js";
import { LocalFileSearchService } from "./local-file-search.js";
import { registerHistoryStorageRoutes } from "./routes/history-storage-routes.js";
import { registerEngineRoutes } from "./routes/engine-routes.js";
import { WorkbenchChanges } from "./workbench-changes.js";
import { registerWorkbenchEvents } from "./routes/resource-change-events.js";
import type {
  AgentGlobalSettings,
  AgentModel,
  AgentProjectDefaults,
  AgentTaskSettings,
} from "@codexly/protocol";
import Fastify, { type FastifyInstance } from "fastify";
import { AttachmentStore } from "./attachment-store.js";
import { commitSelectedProjectChanges, pushProjectCommits } from "./git-commit.js";
import { readProjectGitCommitFileDiff, readProjectGitCommitFiles } from "./git-commit-review.js";
import { buildCommitMessagePrompt } from "./git-commit-message.js";
import * as gitBranch from "./git-branch.js";
import * as gitWorktree from "./git-worktree.js";
import { readProjectGitHistory } from "./git-history.js";
import { readProjectGitStatus as readGitProjectStatus } from "./git-working-tree.js";
import { readHostFileDirectory, resolveHostAttachment } from "./host-file-browser.js";
import { createIdempotencyRunner } from "./idempotency-runner.js";
import { readProjectFileTree } from "./project-file-tree.js";
import { readProjectFileDownload } from "./project-file-download.js";
import { deleteProjectFile, renameProjectFile } from "./project-file-mutations.js";
import { readProjectImageFile } from "./project-image-file.js";
import { readProjectSourceFile } from "./project-source-file.js";
import { createProviderTurnInputResolver } from "./provider-turn-input-resolver.js";
import { createDisabledProjectOpenService, createProjectOpenService } from "./project-open.js";
import { createSkillMarketService } from "./skill-market-service.js";
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
import { registerSearchRoutes } from "./routes/search-routes.js";
import { registerTurnRoutes } from "./routes/turn-routes.js";
import { registerSubmissionRoutes } from "./routes/submission-routes.js";
import { registerAsyncQuestionRoutes } from "./routes/async-question-routes.js";
import { registerProjectTodoRoutes } from "./routes/project-todo-routes.js";
import { createMemorySubmissionRepository } from "./task-submission-service.js";
import { registerQueueRoutes } from "./routes/queue-routes.js";
import { registerSkillMarketRoutes } from "./routes/skill-market-routes.js";
import { registerScheduledTaskRoutes } from "./routes/scheduled-task-routes.js";
import { createScheduledTasks } from "./scheduled-task-assembly.js";
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
  const diagnosticLogs = new DiagnosticLogBuffer();
  const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  const logger = createDiagnosticLogger(diagnosticLogs, options);
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
  const readFileDownload = options.readProjectFileDownload ?? readProjectFileDownload;
  const localFileSearch = new LocalFileSearchService();
  const searchProjectFiles =
    options.searchProjectFiles ?? ((input) => localFileSearch.search(input));
  const stopProjectFileSearch =
    options.stopProjectFileSearch ??
    ((projectId, sessionId) => localFileSearch.stop(projectId, sessionId));
  const readImageFile = options.readProjectImageFile ?? readProjectImageFile;
  const readSourceFile = options.readProjectSourceFile ?? readProjectSourceFile;
  // LAN 客户端与服务端可能不在同一宿主，禁止暴露或执行服务端桌面应用。
  const projectOpenService =
    options.access === undefined
      ? (options.projectOpenService ?? createProjectOpenService())
      : createDisabledProjectOpenService();
  const workspaceBrowserOptions =
    options.workspaceRoots === undefined ? {} : { workspaceRoots: options.workspaceRoots };
  const browseProjectDirectory =
    options.readProjectDirectory ??
    ((path, browserOptions) =>
      readProjectDirectory(path, { ...browserOptions, ...workspaceBrowserOptions }));
  const selectProjectDirectory =
    options.resolveProjectDirectory ??
    ((path) => resolveProjectDirectory(path, workspaceBrowserOptions));
  const skillMarketService =
    options.skillMarketService ??
    createSkillMarketService({
      projectOpenService,
      projectRepository: options.projectRepository,
      provider: options.provider,
    });
  const attachmentStore = new AttachmentStore();
  const workbenchChanges = new WorkbenchChanges();
  const resolveProviderTurnInput = createProviderTurnInputResolver(
    attachmentStore,
    (projectId, id) =>
      options.projectTodoRepository?.readProjectTodoAttachment(projectId, id) ??
      Promise.resolve(undefined),
  );
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
  if (options.preloadModelCatalog === true) {
    // 启动阶段主动刷新在线目录；失败时 loader 已按连接身份回退持久化缓存。
    await modelCatalogCache.read().catch(() => undefined);
  }
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
          onAttachmentReleaseError: () => {
            app.log.warn(
              { errorCode: "ATTACHMENT_CLEANUP_FAILED" },
              "Failed to release turn attachments",
            );
          },
          onTurnCompleted: (runtime) => taskQueue.startNext(runtime),
          workbenchChanges,
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
      if (!preserveQueuedAttachments) workbenchChanges.forgetProject(projectId);
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
    // 后台运行和等待审批不能因没有打开项目页面而被空闲回收。
    hasActiveTasks: (projectId) => workbenchChanges.taskActivities.hasActiveProject(projectId),
    idleTtlMs: options.projectRuntimeIdleTtlMs ?? DEFAULT_PROJECT_RUNTIME_IDLE_TTL_MS,
    onReleaseError: (_error, projectId) => {
      app.log.warn(
        { errorCode: "PROJECT_RELEASE_FAILED", projectId },
        "Failed to release idle Project runtime",
      );
    },
    release: (projectId) => releaseProjectContext(projectId, true),
  });
  const listModels = async (
    engine: "codex" | "claude" = "codex",
  ): Promise<readonly AgentModel[]> => {
    if (engine === "codex") return (await modelCatalogCache.read()).data;
    const service = options.provider.engines?.[engine];
    if (!service) throw new Error("Claude engine is unavailable");
    return (await service.inspect()).models.data;
  };
  const readEffectiveGlobalSettings = async (
    models?: readonly AgentModel[],
    engine: "codex" | "claude" = "codex",
  ): Promise<AgentGlobalSettings> => {
    const catalog = models ?? (await listModels(engine));
    const stored = await options.settingsRepository.readGlobalSettings();
    // Codex 是智能体默认值的来源；本地记录仅补齐未配置字段与应用专属偏好。
    const runtimeDefaults = engine === "codex" ? await options.provider.readDefaultSettings() : {};
    const generation = await options.provider.readGenerationDefaults?.(stored);
    return {
      ...resolveGlobalSettings(
        catalog,
        stored,
        runtimeDefaults,
        engine === "claude" && !stored?.defaultAgent ? ["claude"] : ["codex", "claude"],
      ),
      ...generation,
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
    const stored = await options.settingsRepository.readTaskSettings(projectId, taskId);
    const metadata = await (
      await getProjectContext(projectId)
    )?.provider.readTaskMetadata?.(taskId);
    if (metadata?.engine === "claude") {
      // Claude 设置只取自身会话或目录，绝不继承 Codex 全局模型、沙盒和 Guardian。
      if (stored?.engineOptions?.engine === "claude") return stored;
      const defaults = await options.provider.engines?.claude?.readSettings();
      return {
        model: defaults?.model ?? "default",
        reasoningEffort: defaults?.reasoningEffort ?? "",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxMode: "workspace-write",
        engineOptions: { engine: "claude", permissionMode: defaults?.permissionMode ?? "default" },
      };
    }
    const catalog = models ?? (await listModels());
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
  const { scheduledTaskAttachmentManager, scheduledTaskService } = await createScheduledTasks(
    options,
    attachmentStore,
    getProjectContext,
    listModels,
    resolveProviderTurnInput,
  );
  const activeGitMutations = new Set<string>();
  const taskStartRecoveries = new Map<string, TaskStartRecovery>();
  const idempotencyCacheSize = options.idempotencyCacheSize ?? DEFAULT_IDEMPOTENCY_CACHE_SIZE;
  const idempotencyTtlMs = options.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  const idempotencyRunner = createIdempotencyRunner(idempotencyCacheSize, idempotencyTtlMs);
  const { accessService, websocketLifecycle } = await configureServerDelivery(app, {
    ...(options.access === undefined ? {} : { access: options.access }),
    ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
    releaseResources: async () => {
      await scheduledTaskService.close();
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
    websocketLifecycle,
    workbenchChanges,
    ...(options.asyncQuestionRepository === undefined
      ? {}
      : { asyncQuestionRepository: options.asyncQuestionRepository }),
    ...(options.projectTodoRepository === undefined
      ? {}
      : { projectTodoRepository: options.projectTodoRepository }),
    submissionRepository:
      options.submissionRepository ?? createMemorySubmissionRepository(idempotencyCacheSize),
    ...(accessService === undefined ? {} : { accessService }),
    activeGitMutations,
    assertCommitSelection,
    assertValidProjectDefaults,
    attachmentStore,
    buildCommitMessagePrompt,
    capabilities,
    commitProjectChanges,
    pushProjectCommits: options.pushProjectCommits ?? pushProjectCommits,
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
    readAppUpdateProgress: options.readAppUpdateProgress,
    readEffectiveGlobalSettings,
    readEffectiveProjectDefaults,
    readEffectiveTaskSettings,
    readFileTree,
    readFileDownload,
    deleteProjectFile: options.deleteProjectFile ?? deleteProjectFile,
    renameProjectFile: options.renameProjectFile ?? renameProjectFile,
    searchProjectFiles,
    stopProjectFileSearch,
    readHostFileDirectory: options.readHostFileDirectory ?? readHostFileDirectory,
    readProjectDirectory: browseProjectDirectory,
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
    resolveProjectDirectory: selectProjectDirectory,
    resolveHostAttachment: options.resolveHostAttachment ?? resolveHostAttachment,
    readScheduledTaskAttachment: async (projectId, attachmentId) =>
      scheduledTaskAttachmentManager === undefined
        ? undefined
        : scheduledTaskAttachmentManager.read(projectId, attachmentId),
    settingsRepository: options.settingsRepository,
    scheduledTaskService,
    skillMarketService,
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
  registerDiagnosticRoutes(app, diagnosticLogs);
  await app.register(registerRuntimeRoutes, routeContext);
  await app.register(registerEngineRoutes, routeContext);
  await app.register(registerPersonalizationRoutes, routeContext);
  await app.register(registerHistoryStorageRoutes(options.tokenUsageStore), routeContext);
  await app.register(registerProviderConnectionRoutes, routeContext);
  await app.register(registerPetRoutes, routeContext);
  await app.register(registerProjectRoutes, routeContext);
  await app.register(registerSkillMarketRoutes, routeContext);
  await app.register(registerScheduledTaskRoutes, routeContext);
  await app.register(registerTaskRoutes, routeContext);
  await app.register(registerSearchRoutes, routeContext);
  await app.register(registerTurnRoutes, routeContext);
  await app.register(registerSubmissionRoutes, routeContext);
  await app.register(registerAsyncQuestionRoutes, routeContext);
  await app.register(registerProjectTodoRoutes, routeContext);
  registerWorkbenchEvents(app, routeContext);
  await app.register(registerQueueRoutes, routeContext);
  await app.register(registerEventRoutes, routeContext);
  await app.ready();
  return app;
}
import { registerPersonalizationRoutes } from "./routes/personalization-routes.js";
