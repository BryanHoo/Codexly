import { join } from "node:path";
import {
  EngineProjectRouter,
  type AgentProvider,
  type AgentRuntimeProvider,
  type AgentTaskScope,
  type LocalCatalogStore,
} from "@codexly/core";
import { ClaudeRuntime } from "@codexly/provider-claude";

/** 仅生产本地仓储启用双引擎；Codex 全局功能仍直接调用原运行时。 */
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
  const projects = new Map<string, { router: EngineProjectRouter; codex: AgentProvider }>();
  const create = (scope: AgentTaskScope, provider: AgentProvider) => {
    const existing = projects.get(scope.id);
    if (existing) return existing.router;
    const router = new EngineProjectRouter(scope, catalog, {
      codex: provider,
      claude: claude.forScope(scope),
    });
    projects.set(scope.id, { router, codex: provider });
    return router;
  };
  const overrides: Partial<AgentRuntimeProvider> = {
    engines: { ...codex.engines, claude },
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
        codex.forProject(project),
      ),
    forTemporary: (rootPath) =>
      create(
        { id: "temporary", kind: "temporary", rootPath, runtimeWorkspaceRoots: [rootPath] },
        codex.forTemporary(rootPath),
      ),
    releaseProject: async (projectId, expected) => {
      const existing = projects.get(projectId);
      if (expected && existing?.router !== expected) return;
      await codex.releaseProject(projectId, existing?.codex);
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
