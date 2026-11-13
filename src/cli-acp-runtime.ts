import { join } from "node:path";
import type { AgentRuntimeProvider, LocalCatalogStore } from "@codexly/core";
import {
  AcpApplicationRuntime,
  createOfficialAcpLauncher,
  readAcpLegacyApplicationSettings,
  type AcpAgentLauncher,
} from "@codexly/provider-acp";
import type { CliManagedStateRepository } from "./cli-state-repository.js";

export interface CliAcpRuntime extends AgentRuntimeProvider {
  close(): Promise<void>;
}
export interface CreateCliAcpRuntimeInput {
  applicationDirectory: string;
  store: CliManagedStateRepository & LocalCatalogStore;
  environment: NodeJS.ProcessEnv;
  launch?: AcpAgentLauncher;
}

/** CLI 与桌面共用同一 ACP 实现；旧应用文件和 SQLite 偏好只读导入，不启动旧执行端口。 */
export function createCliAcpRuntime(input: CreateCliAcpRuntimeInput): CliAcpRuntime {
  return new AcpApplicationRuntime(
    join(input.applicationDirectory, "engines", "acp"),
    input.store,
    () => input.store.readGlobalSettings(),
    input.launch ?? createOfficialAcpLauncher(input.environment),
    async (engine) => {
      const source = await readAcpLegacyApplicationSettings(input.applicationDirectory, engine);
      return engine === "codex"
        ? {
            ...source,
            settings: { ...source.settings, ...(await input.store.readGlobalSettings()) },
          }
        : source;
    },
  );
}
