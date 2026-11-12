import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  EngineProjectRouter,
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
import { AcpProcess } from "./process.js";
import { AcpHistory } from "./history.js";
import { AcpAgentProvider } from "./provider.js";
import { AcpAgentService } from "./agent-service.js";
import { prepareAcpDefaults } from "./configuration.js";
import { AcpSettingsStore, type AcpLegacySettingsSource } from "./settings-store.js";
import { AcpProviderRouting } from "./provider-routing.js";
import { AcpTaskTitles } from "./task-titles.js";
const require = createRequire(import.meta.url);
/** 只解析官方包声明的可执行入口；不运行动态 npx、不拼接 shell，也不导入厂商 SDK。 */
const launchOfficialAgent: AcpAgentLauncher = async (engine, scope, callbacks) => {
  const name =
    engine === "codex" ? "@agentclientprotocol/codex-acp" : "@agentclientprotocol/claude-agent-acp";
  const manifest = require.resolve(`${name}/package.json`);
  const metadata = JSON.parse(await readFile(manifest, "utf8")) as {
    bin: string | Record<string, string>;
  };
  const entry = typeof metadata.bin === "string" ? metadata.bin : Object.values(metadata.bin)[0];
  if (!entry) throw new Error("ACP agent 未声明可执行入口");
  return AcpProcess.start(
    { command: process.execPath, args: [resolve(dirname(manifest), entry)], cwd: scope.rootPath },
    callbacks,
  );
};
interface Entry {
  scope: AgentTaskScope;
  router: EngineProjectRouter;
  providers: AcpAgentProvider[];
  handles: Set<AcpAgentHandle>;
  titles: AcpTaskTitles[];
}
/** Web 和桌面宿主共用项目装配与资源生命周期；全局配置 API 由后续交付接入。 */
export class AcpRuntime {
  readonly settings: AcpSettingsStore;
  readonly agents: Readonly<Record<AgentEngine, AcpAgentService>>;
  readonly #entries = new Map<string, Entry>();
  readonly #history: AcpHistory;
  readonly #preferences: ApplicationPreferencesService;
  #closed = false;
  readonly #generations = new Set<Promise<string>>();
  constructor(
    readonly directory: string,
    readonly store: LocalCatalogStore,
    readonly launch: AcpAgentLauncher = launchOfficialAgent,
    legacySource?: AcpLegacySettingsSource,
    readPreferences: () => Promise<unknown> = () => Promise.resolve(undefined),
  ) {
    this.#preferences = new ApplicationPreferencesService(store, readPreferences);
    this.#history = new AcpHistory(join(directory, "history"));
    this.settings = new AcpSettingsStore(join(directory, "settings"), legacySource);
    this.agents = {
      codex: new AcpAgentService("codex", directory, this.settings, launch),
      claude: new AcpAgentService("claude", directory, this.settings, launch),
    };
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
    const provider = entry?.providers[engine === "codex" ? 0 : 1];
    if (!provider) throw new Error("ACP 辅助 Provider 不可用");
    const pending = provider.generateText(text, model, signal);
    this.#generations.add(pending);
    try {
      return await pending;
    } finally {
      this.#generations.delete(pending);
    }
  }
  async startConfiguredTurn(scope: AgentTaskScope, id: string, input: AgentProviderTurnInput) {
    this.forScope(scope);
    const task = await this.store.catalog("task.read", { id });
    if (!task) throw new Error("ACP queue task not found");
    const provider = this.#entries.get(scope.id)?.providers[task.provider === "codex" ? 0 : 1];
    if (!provider) throw new Error("ACP provider unavailable");
    return provider.startConfiguredTurn(id, input);
  }
  importCatalog(engine: AgentEngine, signal?: AbortSignal): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("ACP Runtime 已关闭"));
    return this.agents[engine].importCatalog(this.store, signal);
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
    const create = (engine: AgentEngine) =>
      new AcpAgentProvider(
        engine,
        scope,
        this.store,
        this.#history,
        async (callbacks) => {
          const handle = await this.launch(engine, scope, callbacks);
          // 在会话创建/恢复前恢复 ACP 路由；失败回收本次连接，不回退到默认供应商。
          try {
            await new AcpProviderRouting(engine, this.settings).restore(handle.connection);
          } catch (error) {
            await handle.close();
            throw error;
          }
          handles.add(handle);
          void handle.connection.closed
            .then(() => handle.close())
            .finally(() => {
              handles.delete(handle);
            })
            .catch(() => undefined);
          return handle.connection;
        },
        async (connection, sessionId, options) => {
          const saved = await this.settings.read(engine);
          return (await prepareAcpDefaults(connection, sessionId, options, saved)).configOptions;
        },
      );
    const codex = create("codex"),
      claude = create("claude");
    const titles = [codex, claude].map((provider) => {
      const scheduler = new AcpTaskTitles(
        this.store,
        provider.engine,
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
      return scheduler;
    });
    const router = new EngineProjectRouter(scope, this.store, { codex, claude });
    this.#entries.set(scope.id, { scope, router, providers: [codex, claude], handles, titles });
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
    if (this.#entries.get(id) === entry) this.#entries.delete(id);
  }
  async close(): Promise<void> {
    this.#closed = true;
    const results = await Promise.allSettled([
      ...[...this.#entries.keys()].map((id) => this.releaseProject(id)),
      ...Object.values(this.agents).map((service) => service.close()),
    ]);
    await Promise.allSettled(this.#generations);
    const errors = results.filter((result) => result.status === "rejected");
    if (errors.length)
      throw new AggregateError(
        errors.map((result): unknown => result.reason),
        "ACP Runtime 关闭失败",
      );
  }
}
