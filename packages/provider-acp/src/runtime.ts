import type { SaveAgentInstructions } from "@codexly/protocol/application-preferences";
import { nativeInstructionsPlan, replaceNativeInstructions } from "./native-global-instructions.js";
import { readAcpCodexHistory } from "./codex-read-only-history.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  EngineProjectRouter,
  CatalogSearchService,
  checkSearchCancellation,
  ApplicationPreferencesService,
  generateApplicationText,
  type AgentProvider,
  type AgentProviderTurnInput,
  type AgentTaskScope,
  type LocalCatalogStore,
} from "@codexly/core";
import type { AgentEngine, Project } from "@codexly/protocol";
import type { AcpAgentHandle, AcpAgentLauncher } from "./agent-launcher.js";
export type { AcpAgentHandle, AcpAgentLauncher } from "./agent-launcher.js";
import { AcpAgentCatalog } from "./agent-catalog.js";
import { AcpProcess } from "./process.js";
import { isAgentEngine } from "@codexly/protocol";
import { AcpHistory } from "./history.js";
import { AcpAgentProvider } from "./provider.js";
import { AcpAgentService } from "./agent-service.js";
import { prepareAcpDefaults } from "./configuration.js";
import { AcpSettingsStore, type AcpLegacySettingsSource } from "./settings-store.js";
import { AcpProviderRouting } from "./provider-routing.js";
import { AcpTaskTitles } from "./task-titles.js";
import { AcpStorageLeases } from "./storage-lease.js";
import { searchAcpHistory } from "./history-search.js";
import { AcpSessionInitialization } from "./session-initialization.js";
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
  };
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
      {},
      new AcpStorageLeases(store),
      environment,
    );
    const snapshot = { ...environment };
    this.#environment = snapshot;
    this.launch =
      launch ??
      (async (engine, scope, callbacks) => {
        const command = await this.catalog.command(engine);
        return AcpProcess.start(
          { ...command, env: { ...snapshot, ...command.env }, cwd: scope.rootPath },
          callbacks,
        );
      });
    launch = this.launch;
    this.#preferences = new ApplicationPreferencesService(store, readPreferences);
    const leases = new AcpStorageLeases(store);
    this.#leases = leases;
    this.#history = new AcpHistory(join(directory, "history"), leases);
    this.settings = new AcpSettingsStore(join(directory, "settings"), legacySource, leases);
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
          provider.readExternalHistory = this.#readExternalHistory;
          const pending = (async () => {
            try {
              await provider.readTask(task.id, { signal: controller.signal });
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
    const services = { catalog: this.catalog } as Record<AgentEngine, AcpAgentService> & {
      catalog: AcpAgentCatalog;
    };
    this.agents = new Proxy(services, {
      get: (target, key, receiver) => {
        if (isAgentEngine(key) && !Object.hasOwn(target, key)) {
          this.#checkOpen();
          target[key] = new AcpAgentService(key, directory, this.settings, this.launch, store);
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
  }
  readonly #readExternalHistory: typeof readAcpCodexHistory = async (task, input) => {
    if (task.provider !== "codex") throw new Error("此 Agent 不支持 Codex 只读历史");
    const command = await this.catalog.command(task.provider);
    return readAcpCodexHistory(task, input, {
      ...command,
      env: { ...this.#environment, ...command.env },
    });
  };
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
        async (callbacks) => {
          // 协议流关闭不代表子进程已退出。重连前先回收旧进程，避免两个 Agent 同时占用原会话。
          await reapByEngine.get(engine);
          const handle = await this.launch(engine, scope, callbacks);
          // 在会话创建/恢复前恢复 ACP 路由；失败回收本次连接，不回退到默认供应商。
          try {
            await new AcpProviderRouting(engine, this.settings).restore(handle.connection);
          } catch (error) {
            await handle.close();
            throw error;
          }
          handles.add(handle);
          const reaped = handle.connection.closed.then(() => handle.close());
          reapByEngine.set(engine, reaped);
          void reaped
            .finally(() => {
              handles.delete(handle);
              if (reapByEngine.get(engine) === reaped) reapByEngine.delete(engine);
            })
            .catch(() => undefined);
          return handle.connection;
        },
        async (connection, sessionId, options, frozen) => {
          const saved = frozen ?? (await this.settings.read(engine));
          return (await prepareAcpDefaults(connection, sessionId, options, saved)).configOptions;
        },
        this.#initialization,
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
          provider.readExternalHistory = this.#readExternalHistory;
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
          provider.prepareTaskTitle = (task, input) => scheduler.prepare(task, input);
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
