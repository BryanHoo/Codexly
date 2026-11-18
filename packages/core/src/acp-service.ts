import type {
  AcpAgentCatalogPage,
  AcpAgentCatalogProgress,
  AcpAgentRegistration,
} from "@codexly/protocol";
import type {
  AcpAuthCredentials,
  AcpConfigPreview,
  AcpConfigPreviewRequest,
  AcpAgentProfile,
  AcpConfigValues,
  AcpDefaults,
  AgentEngine,
} from "@codexly/protocol";
import type { AcpProviderConfig, AcpProviderPage } from "@codexly/protocol";

/** 两端共享 ACP 原生认证与默认设置；不暴露厂商账号、配置文件或私有 RPC。 */
export interface AcpAgentSettingsService {
  readonly providers?: {
    list(): Promise<AcpProviderPage>;
    configure(config: AcpProviderConfig): Promise<AcpProviderPage>;
    disable(providerId: string): Promise<AcpProviderPage>;
  };

  previewConfig?(
    cwd: string,
    input: AcpConfigPreviewRequest,
    signal?: AbortSignal,
  ): Promise<AcpConfigPreview>;
  inspect(): Promise<AcpAgentProfile>;
  authenticate(
    methodId: string,
    signal?: AbortSignal,
    credentials?: AcpAuthCredentials,
  ): Promise<Record<string, never>>;
  readDefaults(): Promise<AcpDefaults>;
  updateDefaults(values: AcpConfigValues): Promise<AcpDefaults>;
  setDefaultConfig(configId: string, value: string | boolean): Promise<AcpDefaults>;
}
export interface AcpAgentCatalogService {
  refresh?(): Promise<AcpAgentCatalogPage>;
  list(discover?: boolean): Promise<AcpAgentCatalogPage>;
  progress?(): AcpAgentCatalogProgress;
  update?(engine: AgentEngine): Promise<void>;
  remove?(engine: AgentEngine): Promise<void>;
  install(engine: AgentEngine): Promise<void>;
  configure(input: AcpAgentRegistration): Promise<void>;
}
export type AcpAgentServices = Readonly<Record<AgentEngine, AcpAgentSettingsService>> & {
  readonly catalog?: AcpAgentCatalogService;
};
