import type { OfficialPluginPage, PluginReconcileResult } from "@codexly/protocol";

interface Client {
  reconcileOfficialPlugins(): Promise<PluginReconcileResult>;
  listOfficialPlugins(forceRefetch: boolean): Promise<OfficialPluginPage>;
}
interface Effects {
  onReconciled(result: PluginReconcileResult): void | Promise<void>;
  onCatalog(page: OfficialPluginPage, result: PluginReconcileResult): void | Promise<void>;
}
const pending = new WeakMap<Client, Promise<PluginReconcileResult>>();

export function refreshOfficialPlugins(
  client: Client,
  effects: Effects,
): Promise<PluginReconcileResult> {
  const existing = pending.get(client);
  if (existing !== undefined) return existing;
  const request = (async () => {
    const result = await client.reconcileOfficialPlugins();
    // 先应用变化提示；后续目录读取失败时也不能丢掉已发生的同步结果。
    await effects.onReconciled(result);
    await effects.onCatalog(await client.listOfficialPlugins(true), result);
    return result;
  })().finally(() => pending.delete(client));
  // 同一客户端仅保留一个在途刷新，不缓存本次变化，也不增加后台轮询。
  pending.set(client, request);
  return request;
}

export function createPluginQueryInvalidator(
  result: PluginReconcileResult,
  catalog?: OfficialPluginPage,
) {
  const ids = new Set(result.changedPlugins.map((plugin) => plugin.id));
  const detailKeys = new Set(
    (catalog?.data ?? [])
      .filter((plugin) => ids.has(plugin.id))
      .map((plugin) =>
        JSON.stringify([plugin.marketplaceName, plugin.marketplacePath, plugin.pluginName]),
      ),
  );
  const skillsChanged = result.changedPlugins.some((plugin) => plugin.hasSkills);
  const mcpsChanged = result.changedPlugins.some((plugin) => plugin.hasMcps);
  return (key: readonly unknown[], data?: unknown): boolean => {
    if (key[0] === "extensions") {
      if (key[1] === "skills") return skillsChanged;
      // Apps 和 Hooks 当前随插件详情展示；删除的插件也按旧详情 ID 失效。
      return (
        key[1] === "plugins" &&
        key[2] === "detail" &&
        (detailKeys.has(JSON.stringify(key.slice(3))) ||
          (typeof data === "object" &&
            data !== null &&
            "id" in data &&
            typeof data.id === "string" &&
            ids.has(data.id)))
      );
    }
    return (
      key[0] === "projects" &&
      ((skillsChanged && key.length === 3 && key[2] === "skills") ||
        (mcpsChanged && key.length === 5 && key[2] === "tasks" && key[4] === "mcp-servers"))
    );
  };
}

export function getPluginCatalogChanges(
  previous: OfficialPluginPage | undefined,
  next: OfficialPluginPage,
  observed?: PluginReconcileResult,
): PluginReconcileResult {
  const changed = new Set<string>();
  if (previous !== undefined) {
    const oldPlugins = new Map(previous.data.map((plugin) => [plugin.id, plugin]));
    for (const plugin of next.data) {
      const old = oldPlugins.get(plugin.id);
      if (
        old === undefined ||
        old.installed !== plugin.installed ||
        old.enabled !== plugin.enabled ||
        old.localVersion !== plugin.localVersion ||
        old.version !== plugin.version
      )
        changed.add(plugin.id);
      oldPlugins.delete(plugin.id);
    }
    for (const id of oldPlugins.keys()) changed.add(id);
  }
  for (const plugin of observed?.changedPlugins ?? []) changed.delete(plugin.id);
  // 上游变化不是累计游标；目录差异补足后台同步已消费的变更，避免继续显示旧资源。
  return {
    changedPlugins: [...changed].map((id) => ({
      id,
      hasApps: true,
      hasHooks: true,
      hasMcps: true,
      hasSkills: true,
    })),
    failedRemotePluginIds: [],
    failedMaterializationRemotePluginIds: [],
  };
}

export const officialPluginsQueryKey = ["extensions", "plugins"] as const;
interface Query {
  queryKey: readonly unknown[];
  state: { data: unknown };
}
interface QueryFilter {
  predicate?: (query: Query) => boolean;
  queryKey?: readonly unknown[];
  exact?: boolean;
}
interface QueryCache {
  getQueryData(key: readonly unknown[]): unknown;
  setQueryData(key: readonly unknown[], value: OfficialPluginPage): unknown;
  cancelQueries(filter: QueryFilter): Promise<unknown>;
  invalidateQueries(filter: QueryFilter): Promise<unknown>;
}

export async function refreshPluginQueries(
  client: Client,
  cache: QueryCache,
  onReconciled: (result: PluginReconcileResult) => void,
): Promise<PluginReconcileResult> {
  // 取消旧目录和详情读取，防止同步后被先前的在途请求覆盖。
  await cache.cancelQueries({ queryKey: officialPluginsQueryKey, exact: true });
  const previous = cache.getQueryData(officialPluginsQueryKey) as OfficialPluginPage | undefined;
  const invalidate = async (result: PluginReconcileResult) => {
    const affected = createPluginQueryInvalidator(result, previous);
    const predicate = (query: Query) => affected(query.queryKey, query.state.data);
    await cache.cancelQueries({ predicate });
    // 只刷新仍在显示的受影响资源；其余缓存标为失效，在下次进入时读取。
    void cache.invalidateQueries({ predicate });
  };
  return refreshOfficialPlugins(client, {
    onCatalog: async (catalog, result) => {
      cache.setQueryData(officialPluginsQueryKey, catalog);
      await invalidate(getPluginCatalogChanges(previous, catalog, result));
    },
    onReconciled: async (result) => {
      onReconciled(result);
      await invalidate(result);
    },
  });
}
