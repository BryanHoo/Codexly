import { join } from "node:path";
import { readLocalGenerationConnection } from "./cli-generation-defaults.js";
import {
  EngineProjectRouter,
  readGenerationDefaults,
  CatalogSearchService,
  type AgentProvider,
  type AgentRuntimeProvider,
  type AgentTaskScope,
  type AgentProviderEventListener,
  type AgentProviderEventSubscriptionOptions,
  type LocalCatalogStore,
} from "@codexly/core";
import { ClaudeRuntime } from "@codexly/provider-claude";

/** 项目事件订阅不创建 Codex Provider，避免其 Git watch 在 Claude 首屏启动进程。 */
function deferCodexProject(create: () => AgentProvider) {
  let current: AgentProvider | undefined;
  const listeners = new Map<
    AgentProviderEventListener,
    {
      dispose: () => void;
      options: AgentProviderEventSubscriptionOptions | undefined;
    }
  >();
  const resolve = () => {
    if (!current) {
      current = create();
      for (const [listener, subscription] of listeners)
        subscription.dispose = current.subscribeEvents(listener, subscription.options);
    }
    return current;
  };
  const provider = new Proxy({} as AgentProvider, {
    get(_target, key) {
      if (key === "subscribeEvents")
        return (
          listener: AgentProviderEventListener,
          options?: AgentProviderEventSubscriptionOptions,
        ) => {
          // 延迟创建适配器时仍必须保留辅助事件选项，否则临时线程完成后生成请求只能超时。
          listeners.set(listener, {
            options,
            dispose: current?.subscribeEvents(listener, options) ?? (() => undefined),
          });
          return () => {
            listeners.get(listener)?.dispose();
            listeners.delete(listener);
          };
        };
      return (...args: unknown[]) => {
        const target = resolve();
        const method: unknown = Reflect.get(target, key);
        if (typeof method !== "function") throw new Error(`Codex does not support ${String(key)}`);
        return Reflect.apply(method, target, args) as unknown;
      };
    },
  });
  return { provider, current: () => current };
}

/** 仅生产本地仓储启用双引擎；搜索按任务持久身份选择依赖，不探测无关引擎。 */
export function enableClaudeRuntime(
  codex: AgentRuntimeProvider,
  store: unknown,
  codexHome: string,
): AgentRuntimeProvider {
  if (
    !store ||
    typeof store !== "object" ||
    !("catalog" in store) ||
    typeof store.catalog !== "function"
  )
    return codex;
  const catalog = store as LocalCatalogStore;
  const claude = new ClaudeRuntime(join(codexHome, "codexly", "engines", "claude"), catalog);
  const generation = async (cwd: string, text: string, signal: AbortSignal) => {
    const preferences =
      "readGlobalSettings" in store && typeof store.readGlobalSettings === "function"
        ? await (
            store.readGlobalSettings as () => Promise<
              | {
                  defaultAgent?: "codex" | "claude";
                  defaultModel: string;
                  taskTitlePrompt?: string;
                }
              | undefined
            >
          )()
        : undefined;
    const { defaultAgent: engine, defaultModel: model } = await readGenerationDefaults(
      {
        readProviderConnection: () => readLocalGenerationConnection(codexHome),
        engines: { claude },
      },
      preferences,
    );
    signal.throwIfAborted();
    if (engine === "claude")
      return claude.generateTaskTitle(cwd, text, model, signal, preferences?.taskTitlePrompt);
    if (!codex.generateTaskTitle) throw new Error("Codex title generation unavailable");
    return codex.generateTaskTitle(cwd, text, model, signal, preferences?.taskTitlePrompt);
  };
  codex.setTaskTitleGenerator?.(generation);
  claude.setTaskTitleGenerator(generation);
  const projects = new Map<
    string,
    { router: EngineProjectRouter; codex: ReturnType<typeof deferCodexProject> }
  >();
  const create = (scope: AgentTaskScope, factory: () => AgentProvider) => {
    const existing = projects.get(scope.id);
    if (existing) return existing.router;
    const deferred = deferCodexProject(factory);
    const router = new EngineProjectRouter(scope, catalog, {
      codex: deferred.provider,
      // 项目路由长期缓存；执行与订阅必须按需解析，不能固定持有已回收的适配器。
      claude: () => claude.forScope(scope),
    });
    projects.set(scope.id, { router, codex: deferred });
    return router;
  };
  const overrides: Partial<AgentRuntimeProvider> = {
    readGenerationDefaults: (stored) =>
      readGenerationDefaults(
        {
          readProviderConnection: () => readLocalGenerationConnection(codexHome),
          engines: { claude },
        },
        stored,
      ),
    engines: { ...codex.engines, claude },
    search: new CatalogSearchService(catalog, (task, input, signal, limit) => {
      const scope =
        task.projectId === null
          ? { id: "temporary", kind: "temporary" as const }
          : { id: task.projectId, kind: "project" as const };
      if (task.provider === "claude")
        return claude.searchTaskOccurrences(task.id, input, scope, signal, limit);
      if (task.provider !== "codex" || !codex.search)
        throw new Error("Task search engine is unavailable");
      return codex.search.searchTaskOccurrences(task.id, input, scope, signal, limit);
    }),
    forProject: (project) =>
      create(
        {
          id: project.id,
          kind: "project",
          rootPath:
            project.roots[0]?.path ??
            (() => {
              throw new Error("Project root is missing");
            })(),
          runtimeWorkspaceRoots: project.roots.map((root) => root.path),
        },
        () => codex.forProject(project),
      ),
    forTemporary: (rootPath) =>
      create(
        { id: "temporary", kind: "temporary", rootPath, runtimeWorkspaceRoots: [rootPath] },
        () => codex.forTemporary(rootPath),
      ),
    releaseProject: async (projectId, expected) => {
      const existing = projects.get(projectId);
      if (expected && existing?.router !== expected) return;
      const current = existing?.codex.current();
      if (current) await codex.releaseProject(projectId, current);
      claude.release(projectId);
      projects.delete(projectId);
    },
  };
  // 绑定原对象以保留 Codex 的私有字段；不复制或重写其插件、认证和全局配置实现。
  return new Proxy(codex, {
    get(target, key, receiver): unknown {
      if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key) as unknown;
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function" ? (value.bind(target) as unknown) : value;
    },
  });
}
