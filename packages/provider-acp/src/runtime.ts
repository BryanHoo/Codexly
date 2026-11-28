import type { SaveAgentInstructions } from "@codexly/protocol/application-preferences";
import { nativeInstructionsPlan, replaceNativeInstructions } from "./native-global-instructions.js";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  EngineProjectRouter,
  CatalogSearchService,
  checkSearchCancellation,
  ApplicationPreferencesService,
  generateApplicationText,
  type AcpAgentServices,
  type AgentProvider,
  type AgentProviderTurnInput,
  type AgentTaskScope,
  type LocalCatalogStore,
} from "@codexly/core";
import type { AgentEngine, Project } from "@codexly/protocol";
import type { AcpAgentHandle, AcpAgentLaunchOptions, AcpAgentLauncher } from "./agent-launcher.js";
export type { AcpAgentHandle, AcpAgentLauncher } from "./agent-launcher.js";
import { AcpAgentCatalog } from "./agent-catalog.js";
import { launchCatalogAgent } from "./codefree-adapter.js";
import { hasAcpAgentConnection, isAgentEngine } from "@codexly/protocol";
import { AcpHistory } from "./history.js";
import { AcpAgentProvider } from "./provider.js";
import { AcpAgentService } from "./agent-service.js";
import { AcpSettingsStore, type AcpLegacySettingsSource } from "./settings-store.js";
import { AcpProviderRouting } from "./provider-routing.js";
import { AcpTaskTitles } from "./task-titles.js";
import { persistAcpTaskPreview } from "./task-preview.js";
import { AcpStorageLeases } from "./storage-lease.js";
import { searchAcpHistory } from "./history-search.js";
import { AcpSessionInitialization } from "./session-initialization.js";
import { exportTaskAttachment } from "@codexly/core/task-attachments";
import {
  CODEFREE_ENGINE,
  codefreeCredentialRevision,
  launchSignedInCodefree,
} from "./codefree-authorization.js";
import { nativeQuotaReader } from "./account-quota.js";
import { readCodefreeModels } from "./codefree-models.js";
import {
  createAcpStartupConfig,
  initializeStartupAwareSession,
  startupAwareAcpConnector,
} from "./startup-config-runtime.js";
import type { AcpStartupConfig } from "./startup-config.js";
import type { AcpSettingsSnapshots } from "./settings-snapshot.js";
interface Entry {
  scope: AgentTaskScope;
  router: EngineProjectRouter;
  providers: AcpAgentProvider[];
  provider(engine: AgentEngine): AcpAgentProvider;
  handles: Set<AcpAgentHandle>;
  titles: AcpTaskTitles[];
}
/** Web 和桌面宿主共用项目装配与资源生命周期；全局配置 API 由后续交付接入。 */
export class AcpRuntime {
  readonly search: CatalogSearchService;
  readonly settings: AcpSettingsStore;
  readonly agents: Readonly<Record<AgentEngine, AcpAgentService>> & {
    readonly catalog: AcpAgentCatalog;
    readonly startupConfig: NonNullable<AcpAgentServices["startupConfig"]>;
  };
  readonly #startupConfig: AcpStartupConfig;
  readonly #settingsSnapshots: AcpSettingsSnapshots;
  readonly catalog: AcpAgentCatalog;
  readonly launch: AcpAgentLauncher;
  readonly #entries = new Map<string, Entry>();
  readonly #history: AcpHistory;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #preferences: ApplicationPreferencesService;
  readonly #initialization: AcpSessionInitialization;
  readonly #leases: AcpStorageLeases;
  #closed = false;
  readonly #generations = new Set<Promise<string>>();
  readonly #searches = new Map<Promise<unknown>, () => void>();
  constructor(
    readonly directory: string,
    readonly store: LocalCatalogStore,
    launch?: AcpAgentLauncher,
    legacySource?: AcpLegacySettingsSource,
    readPreferences: () => Promise<unknown> = () => Promise.resolve(undefined),
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    this.catalog = new AcpAgentCatalog(
      join(directory, "agents"),
      { connected: async (engine) => hasAcpAgentConnection(await this.agents[engine]?.inspect()) },
      new AcpStorageLeases(store),
      environment,
    );
    const snapshot = { ...environment };
    this.#environment = snapshot;
    this.launch =
      launch ??
      (async (engine, scope, callbacks, options) => {
        const command = await this.catalog.command(engine, options?.allowDisabled);
        const env = { ...snapshot, ...command.env };
        const start = (launchOptions?: AcpAgentLaunchOptions) =>
          launchCatalogAgent(
            engine,
            {
              ...command,
              env,
              cwd: scope.rootPath,
            },
            callbacks,
            launchOptions,
          );
        // 设置登录与状态探测各自管理授权 stderr，普通项目连接只接受已登录状态。
        return engine === CODEFREE_ENGINE && !options?.onStderrLine
          ? launchSignedInCodefree(env, start, options)
          : start(options);
      });
    launch = this.launch;
    this.#preferences = new ApplicationPreferencesService(store, readPreferences);
    const leases = new AcpStorageLeases(store);
    this.#leases = leases;
    this.#history = new AcpHistory(join(directory, "history"), leases);
    this.settings = new AcpSettingsStore(join(directory, "settings"), legacySource, leases);
    const startup = createAcpStartupConfig(this, leases, snapshot, (engine, signal) => {
      const service = this.agents[engine];
      if (!service) throw new Error("ACP Agent is unavailable");
      return service.readSettingsSnapshot(signal);
    });
    this.#startupConfig = startup.cache;
    this.#settingsSnapshots = startup.settings;
    this.#initialization = new AcpSessionInitialization(
      join(directory, "session-initialization"),
      this.settings,
      leases,
    );
    this.search = new CatalogSearchService(store, async (task, input, signal, limit) => {
      if (this.#closed) throw new Error("ACP Runtime 已关闭");
      checkSearchCancellation(signal);
      // 搜索与冷重放共用同一使用保护；匹配及游标形成之前，不能关闭 Provider 后立即淘汰正文。
      const release = await this.#history.cache.acquire(task.id);
      try {
        const pending = this.#entries
          .get(task.projectId ?? "temporary")
          ?.providers.some((provider) => provider.hasPendingTurn(task.id));
        if (
          !input.cursor &&
          task.sessionId &&
          !pending &&
          !(await this.#history.hasTurns(task.id))
        ) {
          this.#checkOpen();
          if (!isAgentEngine(task.provider)) throw new Error("未知 ACP 搜索引擎");
          if (this.#searches.size >= 4) throw new Error("ACP 冷历史搜索达到并发限制");
          // 冷搜索使用独立短连接，不能修改已经打开的项目根、订阅或会话容量。
          const scope: AgentTaskScope = {
            id: task.projectId ?? "temporary",
            kind: task.projectId === null ? "temporary" : "project",
            rootPath: task.cwd,
            runtimeWorkspaceRoots: [task.cwd],
          };
          let handle: AcpAgentHandle | undefined;
          const controller = new AbortController();
          const stop = () => {
            controller.abort();
            void handle?.close().catch(() => undefined);
          };
          const provider = new AcpAgentProvider(
            task.provider,
            scope,
            store,
            this.#history,
            async (callbacks) => {
              handle = await launch(task.provider as AgentEngine, scope, callbacks);
              // 取消可能发生在启动等待期间；迟到的新连接必须立即回收，不能继续加载历史。
              if (controller.signal.aborted) {
                await handle.close();
                controller.signal.throwIfAborted();
              }
              await new AcpProviderRouting(task.provider as AgentEngine, this.settings).restore(
                handle.connection,
              );
              return handle.connection;
            },
          );
          const pending = (async () => {
            try {
              const snapshot = await provider.readTask(task.id, { signal: controller.signal });
              // 冷缓存无法回放时，沿用搜索的引擎暂不可用状态，区分正文尚未同步与无匹配。
              if (snapshot.writeAccess === "external" && snapshot.turns.length === 0)
                throw new Error("会话被其他客户端占用，历史尚未同步");
            } finally {
              try {
                await provider.close();
              } finally {
                await handle?.close();
              }
            }
          })();
          this.#searches.set(pending, stop);
          signal?.addEventListener("abort", stop, { once: true });
          if (signal?.aborted) stop();
          try {
            await pending;
          } finally {
            signal?.removeEventListener("abort", stop);
            this.#searches.delete(pending);
          }
        }
        return await searchAcpHistory(this.#history, task.id, input, signal, limit);
      } finally {
        await release();
        await this.#history.cache.prune();
      }
    });
    const services = {
      catalog: this.catalog,
      startupConfig: startup,
    } as unknown as Record<AgentEngine, AcpAgentService> &
      Pick<AcpRuntime["agents"], "startupConfig" | "catalog">;
    this.agents = new Proxy(services, {
      get: (target, key, receiver) => {
        if (isAgentEngine(key) && !Object.hasOwn(target, key)) {
          this.#checkOpen();
          target[key] = new AcpAgentService(
            key,
            directory,
            this.settings,
            this.launch,
            store,
            undefined,
            key === CODEFREE_ENGINE
              ? async () => {
                  const { env } = await this.catalog.command(key, true);
                  return codefreeCredentialRevision({ ...snapshot, ...env });
                }
              : undefined,
            key === CODEFREE_ENGINE
              ? async (scope, run) => {
                  // 桌面预览的 cwd 可能是工作树。聊天连接始终按项目主目录归属。
                  let entry = this.#entries.get(scope.id);
                  if (!entry) {
                    // 桌面首次进入临时工作区时，首发创建目录的步骤可能尚未执行。
                    if (scope.kind === "temporary")
                      await mkdir(scope.rootPath, { recursive: true });
                    const project =
                      scope.kind === "project"
                        ? await this.store.catalog("project.read", { id: scope.id })
                        : undefined;
                    entry = this.#entries.get(scope.id);
                    if (!entry) {
                      const rootPath = project?.path ?? scope.rootPath;
                      this.#scope(
                        rootPath === scope.rootPath
                          ? scope
                          : {
                              ...scope,
                              rootPath,
                              runtimeWorkspaceRoots: [rootPath],
                            },
                      );
                      entry = this.#entries.get(scope.id);
                    }
                  }
                  if (!entry) throw new Error("ACP 项目运行时不可用");
                  return entry.provider(key).preview(run);
                }
              : undefined,
            key === CODEFREE_ENGINE
              ? async (cwd) => readCodefreeModels(await this.catalog.command(key), cwd, snapshot)
              : undefined,
            nativeQuotaReader(key, this.catalog, snapshot, directory),
            () => this.#settingsSnapshots.invalidate(key),
          );
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
  }
  #checkOpen(): void {
    if (this.#closed) throw new Error("ACP Runtime 已关闭");
  }
  async generateText(
    engine: AgentEngine,
    cwd: string,
    text: string,
    model: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    if (this.#closed) throw new Error("ACP Runtime 已关闭");
    if (this.#generations.size >= 2) throw new Error("ACP 辅助生成达到并发限制");
    // 优先复用同工作区的热连接；没有项目时建立独立、受容量限制的辅助作用域。
    let entry = [...this.#entries.values()].find((value) => value.scope.rootPath === cwd);
    if (!entry) {
      const id = `generation-${createHash("sha256").update(cwd).digest("hex")}`;
      this.#scope({ id, kind: "temporary", rootPath: cwd, runtimeWorkspaceRoots: [cwd] });
      entry = this.#entries.get(id);
    }
    const provider = entry?.provider(engine);
    if (!provider) throw new Error("ACP 辅助 Provider 不可用");
    const pending = provider.generateText(text, model, signal);
    this.#generations.add(pending);
    try {
      return await pending;
    } finally {
      this.#generations.delete(pending);
    }
  }
  async getAgentInstructionsTargets() {
    this.#checkOpen();
    const current = await this.#preferences.read();
    return (
      await nativeInstructionsPlan(this.catalog, this.#environment, current.globalInstructions)
    ).targets;
  }
  async saveAgentInstructions(input: SaveAgentInstructions) {
    this.#checkOpen();
    const release = await this.#leases.acquire("application:global-instructions");
    try {
      const current = await this.#preferences.read();
      const plan = await nativeInstructionsPlan(
        this.catalog,
        this.#environment,
        current.globalInstructions,
      );
      if (plan.targets.version !== input.version) throw new Error("全局指令文件已变化，请重新确认");
      return await replaceNativeInstructions(plan.files, input.content, () =>
        this.#preferences.patch({ globalInstructions: input.content }),
      );
    } finally {
      await release();
    }
  }
  async startConfiguredTurn(scope: AgentTaskScope, id: string, input: AgentProviderTurnInput) {
    this.forScope(scope);
    const task = await this.store.catalog("task.read", { id });
    if (!task) throw new Error("ACP queue task not found");
    if (!isAgentEngine(task.provider)) throw new Error("未知 ACP 引擎");
    const provider = this.#entries.get(scope.id)?.provider(task.provider);
    if (!provider) throw new Error("ACP provider unavailable");
    return provider.startConfiguredTurn(id, input);
  }
  importCatalog(engine: AgentEngine, signal?: AbortSignal): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("ACP Runtime 已关闭"));
    const service = this.agents[engine];
    if (!service) return Promise.reject(new Error("Agent unavailable"));
    return service.importCatalog(this.store, signal);
  }
  forProject(project: Project): AgentProvider {
    const rootPath = project.roots[0]?.path;
    if (!rootPath) throw new Error("项目根目录缺失");
    return this.#scope({
      id: project.id,
      kind: "project",
      rootPath,
      runtimeWorkspaceRoots: project.roots.map((root) => root.path),
    });
  }
  forTemporary(rootPath: string): AgentProvider {
    return this.#scope({
      id: "temporary",
      kind: "temporary",
      rootPath,
      runtimeWorkspaceRoots: [rootPath],
    });
  }
  /** 原生读取已校验任务归属的正文附件，导出期间持有缓存使用权。 */
  async exportCachedTaskAttachment(taskId: string, attachmentId: string) {
    const release = await this.#history.cache.acquire(taskId);
    try {
      return await exportTaskAttachment(this.#history.cache.content(taskId), taskId, attachmentId);
    } finally {
      await release();
    }
  }

  forScope(scope: AgentTaskScope): AgentProvider {
    return this.#scope(scope);
  }
  #scope(scope: AgentTaskScope): EngineProjectRouter {
    if (this.#closed) throw new Error("ACP Runtime 已关闭");
    const current = this.#entries.get(scope.id);
    if (current) {
      if (JSON.stringify(current.scope) !== JSON.stringify(scope))
        throw new Error("项目根已改变，请先释放旧运行时");
      return current.router;
    }
    if (this.#entries.size >= 16) throw new Error("ACP 项目运行时达到容量限制");
    const handles = new Set<AcpAgentHandle>();
    const reapByEngine = new Map<AgentEngine, Promise<void>>();
    const create = (engine: AgentEngine) =>
      new AcpAgentProvider(
        engine,
        scope,
        this.store,
        this.#history,
        startupAwareAcpConnector(this, scope, engine, this.#startupConfig, handles, reapByEngine),
        initializeStartupAwareSession(this.#startupConfig, this.settings, engine),
        this.#initialization,
        () => this.#startupConfig.foreground(engine),
      );
    const providers: AcpAgentProvider[] = [];
    const titles: AcpTaskTitles[] = [];
    const adapters = new Proxy({} as Record<AgentEngine, AcpAgentProvider>, {
      get: (target, key) => {
        if (!isAgentEngine(key)) return undefined;
        if (this.#closed || this.#entries.get(scope.id)?.providers !== providers)
          return target[key];
        if (!target[key]) {
          const provider = create(key);
          const scheduler = new AcpTaskTitles(
            this.store,
            key,
            scope.kind === "temporary" ? null : scope.id,
            (id) => this.#history.hasTurns(id),
            async (task, text, signal) =>
              generateApplicationText(
                await this.#preferences.read(),
                task.cwd,
                { purpose: "title", text },
                signal,
                this.generateText.bind(this),
              ),
            (id, title) => {
              provider.publishTaskTitle(id, title);
            },
          );
          provider.prepareTaskTitle = async (task, input) => {
            // 辅助命名可能失败或尚未返回，先保存首条消息预览供两端目录刷新使用。
            await persistAcpTaskPreview(this.store, this.#history, task, input).catch(
              () => undefined,
            );
            await scheduler.prepare(task, input);
          };
          provider.subscribeEvents((event) => {
            scheduler.receive(event);
          });
          target[key] = provider;
          providers.push(provider);
          titles.push(scheduler);
        }
        return target[key];
      },
    });
    const router = new EngineProjectRouter(scope, this.store, adapters);
    this.#entries.set(scope.id, {
      scope,
      router,
      providers,
      handles,
      titles,
      provider: (engine) => {
        const provider = adapters[engine];
        if (!provider) throw new Error("ACP Agent 未注册");
        return provider;
      },
    });
    return router;
  }
  async releaseProject(id: string, expected?: AgentProvider): Promise<void> {
    const entry = this.#entries.get(id);
    if (!entry || (expected && entry.router !== expected)) return;
    for (const scheduler of entry.titles) scheduler.cancel();
    // 先阻止旧引用继续提交，再等待终态写入；即使投影关闭失败也必须尝试回收所有 agent 进程。
    const providers = await Promise.allSettled(entry.providers.map((provider) => provider.close()));
    await Promise.all(entry.titles.map((scheduler) => scheduler.settled()));
    const handles = await Promise.allSettled([...entry.handles].map((handle) => handle.close()));
    const failures = [...providers, ...handles].filter((result) => result.status === "rejected");
    if (failures.length)
      throw new AggregateError(
        failures.map((result): unknown => result.reason),
        "ACP 项目释放失败",
      );
    await this.#history.cache.prune();
    if (this.#entries.get(id) === entry) this.#entries.delete(id);
  }
  async close(catalogDisconnected = false): Promise<void> {
    this.#closed = true;
    this.#startupConfig.close();
    this.#settingsSnapshots.close();
    // stdio 已结束时不可再发反向 RPC；存储 owner 不按时间释放，等待进程死亡证明。
    if (catalogDisconnected) this.#history.cache.disconnect();
    for (const stop of this.#searches.values()) stop();
    const results = await Promise.allSettled([
      this.catalog.close(),
      ...[...this.#entries.keys()].map((id) => this.releaseProject(id)),
      ...Object.entries(this.agents)
        .filter(([key]) => isAgentEngine(key))
        .map(([, service]) => (service as AcpAgentService).close()),
    ]);
    await Promise.allSettled(this.#generations);
    await Promise.allSettled(this.#searches.keys());
    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length)
      throw new AggregateError(
        errors.map((result): unknown => result.reason),
        "ACP Runtime 关闭失败",
      );
  }
}
