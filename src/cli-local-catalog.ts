import type { LocalCatalogStore, ProjectProjectionStore } from "@codexly/core";
import {
  createLocalCatalogClient,
  importCodexCatalog,
  type CodexRpcClient,
} from "@codexly/provider-codex";

/** 生产仓储启用本地目录；测试注入的无存储执行端口保持原有职责。 */
export async function prepareLocalCatalog(
  client: CodexRpcClient,
  projection: ProjectProjectionStore,
): Promise<CodexRpcClient> {
  if (!("catalog" in projection) || typeof projection.catalog !== "function") return client;
  const store = projection as ProjectProjectionStore & LocalCatalogStore;
  return createLocalCatalogClient(client, store);
}

/** 引擎目录导入与本地客户端构造分开，懒启动时不创建重复订阅或绑定表。 */
export async function importLocalCatalog(
  client: CodexRpcClient,
  projection: ProjectProjectionStore,
) {
  if (!("catalog" in projection) || typeof projection.catalog !== "function") return;
  await importCodexCatalog(
    client,
    projection as ProjectProjectionStore & LocalCatalogStore,
    await projection.list(),
  );
}
