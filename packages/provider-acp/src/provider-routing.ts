import * as acp from "@agentclientprotocol/sdk/unstable";
import { Value } from "@sinclair/typebox/value";
import {
  AcpProviderConfigSchema,
  type AcpProviderConfig,
  type AcpProviderPage,
  type AgentEngine,
} from "@codexly/protocol";
import type { AcpConnection } from "./connection.js";
import type { AcpSettingsStore } from "./settings-store.js";

/** 只调用 ACP 的通用供应商接口；协议、请求头和模型查询均由 agent 处理。 */
export class AcpProviderRouting {
  #restartRequired = false;
  constructor(
    readonly engine: AgentEngine,
    readonly store: AcpSettingsStore,
  ) {}
  async list(connection: AcpConnection): Promise<AcpProviderPage> {
    if (!connection.initialization.agentCapabilities?.providers)
      throw new Error("ACP agent 不支持供应商配置");
    const { providers } = await connection.transport.agent.request(
      acp.methods.agent.providers.list,
      {},
    );
    return {
      restartRequired: this.#restartRequired,
      providers: providers.map((provider) => ({
        providerId: provider.providerId,
        supported: provider.supported,
        required: provider.required,
        ...(provider.current
          ? { current: { apiType: provider.current.apiType, baseUrl: provider.current.baseUrl } }
          : { current: null }),
      })),
    };
  }
  async #set(connection: AcpConnection, config: AcpProviderConfig): Promise<void> {
    if (!Value.Check(AcpProviderConfigSchema, config)) throw new Error("ACP 供应商配置无效");
    const url = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw new Error("ACP 供应商地址无效");
    const provider = (await this.list(connection)).providers.find(
      (item) => item.providerId === config.providerId,
    );
    if (!provider || !provider.supported.includes(config.apiType))
      throw new Error("ACP 供应商或协议未公布");
    await connection.transport.agent.request(acp.methods.agent.providers.set, config);
  }
  async configure(connection: AcpConnection, config: AcpProviderConfig): Promise<AcpProviderPage> {
    const saved = structuredClone(config);
    await this.#set(connection, saved);
    await this.store.update(this.engine, (current) => ({
      ...current,
      providers: { ...current.providers, [saved.providerId]: saved },
      disabledProviders: (current.disabledProviders ?? []).filter((id) => id !== saved.providerId),
    }));
    // 已经打开的项目连接保持原路由，保存后需重启以统一所有会话；不打断运行中的聊天。
    this.#restartRequired = true;
    return this.list(connection);
  }
  async disable(connection: AcpConnection, providerId: string): Promise<AcpProviderPage> {
    await this.#disable(connection, providerId);
    await this.store.update(this.engine, (current) => ({
      ...current,
      providers: Object.fromEntries(
        Object.entries(current.providers ?? {}).filter(([id]) => id !== providerId),
      ),
      disabledProviders: [...new Set([...(current.disabledProviders ?? []), providerId])],
    }));
    this.#restartRequired = true;
    return this.list(connection);
  }
  async #disable(connection: AcpConnection, providerId: string): Promise<void> {
    const provider = (await this.list(connection)).providers.find(
      (item) => item.providerId === providerId,
    );
    if (!provider) throw new Error("ACP 供应商未公布");
    if (provider.required) throw new Error("ACP 必需供应商不能禁用");
    await connection.transport.agent.request(acp.methods.agent.providers.disable, { providerId });
  }
  async restore(connection: AcpConnection): Promise<void> {
    const saved = await this.store.read(this.engine);
    for (const config of Object.values(saved.providers ?? {})) await this.#set(connection, config);
    for (const id of saved.disabledProviders ?? []) await this.#disable(connection, id);
  }
}
