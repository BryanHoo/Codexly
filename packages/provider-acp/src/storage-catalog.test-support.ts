import type { LocalCatalogStore, CatalogOperations } from "@codexly/core";

/** 仅为协议测试补齐新增的目录端口；真实跨进程互斥由根 SQLite 集成用例验证。 */
export function storageCatalog() {
  const locks = new Map<string, { owner: string; pid: number }>();
  return (operation: unknown, payload: unknown): unknown => {
    const p = payload as { key: string; owner: string; pid: number; expectedOwner: string | null };
    if (operation === "acp.storage.read") return locks.get(p.key) ?? null;
    if (operation === "acp.storage.claim") {
      if ((locks.get(p.key)?.owner ?? null) !== p.expectedOwner) return false;
      locks.set(p.key, { owner: p.owner, pid: p.pid });
      return true;
    }
    if (operation === "acp.storage.release") {
      if (locks.get(p.key)?.owner !== p.owner) return false;
      return locks.delete(p.key);
    }
    return undefined;
  };
}

export function withStorageCatalog(store: LocalCatalogStore): LocalCatalogStore {
  const storage = storageCatalog();
  return {
    catalog: <K extends keyof CatalogOperations>(
      operation: K,
      payload: CatalogOperations[K][0],
    ) => {
      const result = storage(operation, payload);
      return result === undefined
        ? store.catalog(operation, payload)
        : Promise.resolve(result as CatalogOperations[K][1]);
    },
  };
}
