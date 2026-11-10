import * as acp from "@agentclientprotocol/sdk/unstable";
import type { AcpAgentSettingsService } from "@codexly/core";
import type { AcpAgentProfile, AcpConfigValues, AcpDefaults, AgentEngine } from "@codexly/protocol";
import type { AcpAgentHandle, AcpAgentLauncher } from "./agent-launcher.js";
import type { AcpConnection } from "./connection.js";
import type { AcpSettingsStore } from "./settings-store.js";
import { prepareAcpDefaults } from "./configuration.js";
import { AcpProviderRouting } from "./provider-routing.js";
import { importAcpCatalog } from "./catalog-import.js";
import type { LocalCatalogStore } from "@codexly/core";

export class AcpAgentService implements AcpAgentSettingsService {
  readonly providers: NonNullable<AcpAgentSettingsService["providers"]>;
  #handle: Promise<AcpAgentHandle> | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #closed = false;
  constructor(
    readonly engine: AgentEngine,
    readonly cwd: string,
    readonly store: AcpSettingsStore,
    readonly launch: AcpAgentLauncher,
  ) {
    const routing = new AcpProviderRouting(engine, store);
    this.providers = {
      list: () => this.#run(async () => routing.list(await this.#agent())),
      configure: (config) => this.#run(async () => routing.configure(await this.#agent(), config)),
      disable: (id) => this.#run(async () => routing.disable(await this.#agent(), id)),
    };
  }
  #run<T>(action: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("ACP 设置服务已关闭"));
    const result = this.#queue
      .catch(() => undefined)
      .then(() => {
        if (this.#closed) throw new Error("ACP 设置服务已关闭");
        return action();
      });
    this.#queue = result;
    return result;
  }
  async #agent(): Promise<AcpConnection> {
    if (!this.#handle) {
      const pending = this.launch(
        this.engine,
        {
          id: "acp-settings",
          kind: "temporary",
          rootPath: this.cwd,
          runtimeWorkspaceRoots: [this.cwd],
        },
        {},
      ).then(async (handle) => {
        try {
          await new AcpProviderRouting(this.engine, this.store).restore(handle.connection);
          return handle;
        } catch (error) {
          await handle.close();
          throw error;
        }
      });
      this.#handle = pending;
      void pending
        .then((handle) => handle.connection.closed)
        .catch(() => undefined)
        .then(() => {
          if (this.#handle === pending) this.#handle = undefined;
        });
    }
    return (await this.#handle).connection;
  }
  inspect(): Promise<AcpAgentProfile> {
    return this.#run(async () => {
      const { initialization } = await this.#agent();
      return {
        engine: this.engine,
        protocolVersion: initialization.protocolVersion,
        ...(initialization.agentInfo
          ? {
              agentInfo: {
                name: initialization.agentInfo.name,
                version: initialization.agentInfo.version,
                ...(initialization.agentInfo.title
                  ? { title: initialization.agentInfo.title }
                  : {}),
              },
            }
          : {}),
        authMethods: (initialization.authMethods ?? []).map((method) => ({
          id: method.id,
          name: method.name,
          ...(method.description ? { description: method.description } : {}),
          ...("type" in method ? { type: method.type } : {}),
        })),
      };
    });
  }
  authenticate(methodId: string, signal?: AbortSignal): Promise<Record<string, never>> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      const connection = await this.#agent();
      signal?.throwIfAborted();
      const method = connection.initialization.authMethods?.find((value) => value.id === methodId);
      if (!method) throw new Error("ACP 认证方式未公布");
      if ("type" in method) throw new Error("当前宿主未启用 ACP 终端认证");
      try {
        await connection.transport.agent.request(
          acp.methods.agent.authenticate,
          { methodId },
          signal ? { cancellationSignal: signal, stopWaitingOnCancel: true } : undefined,
        );
        signal?.throwIfAborted();
        return {};
      } finally {
        // 认证使用独立连接；取消仅回收这个服务进程，不中断项目中的聊天。
        if (signal?.aborted) await this.#closeHandle();
      }
    });
  }
  readDefaults(): Promise<AcpDefaults> {
    return this.#run(() => this.#defaults());
  }
  importCatalog(catalog: LocalCatalogStore, signal?: AbortSignal): Promise<void> {
    return this.#run(async () => {
      signal?.throwIfAborted();
      await importAcpCatalog(this.engine, await this.#agent(), catalog, signal);
    });
  }
  updateDefaults(values: AcpConfigValues): Promise<AcpDefaults> {
    return this.#run(() => this.#defaults(structuredClone(values)));
  }
  async #defaults(values?: AcpConfigValues): Promise<AcpDefaults> {
    const connection = await this.#agent();
    if (!connection.initialization.agentCapabilities?.sessionCapabilities?.close)
      throw new Error("ACP agent 不支持设置会话关闭");
    const session = await connection.newSession({ cwd: this.cwd, mcpServers: [] });
    const validated = await (async () => {
      try {
        const current = await this.store.read(this.engine);
        return await prepareAcpDefaults(
          connection,
          session.sessionId,
          session.configOptions ?? [],
          current,
          values,
          values === undefined,
        );
      } finally {
        await this.#closeSession(connection, session.sessionId);
      }
    })();
    const { configOptions, defaults, migration, invalidDefaults } = validated;
    // agent 拒绝、连接或关闭失败时不会写默认值；legacy 只在私有记录中留存。
    await this.store.update(this.engine, (latest) => ({
      ...latest,
      ...(migration ? { migration } : {}),
      ...(values
        ? { values: defaults, configured: true }
        : !latest.configured
          ? { values: defaults }
          : {}),
    }));
    return { configOptions, defaults, unmappedLegacy: migration?.unmapped ?? [], invalidDefaults };
  }
  async close(): Promise<void> {
    this.#closed = true;
    // 先关闭传输以解除认证等待，再等待串行操作退场。
    await this.#closeHandle();
    await this.#queue.catch(() => undefined);
  }
  async #closeSession(connection: AcpConnection, sessionId: string): Promise<void> {
    try {
      await connection.closeSession(sessionId);
    } catch (error) {
      await this.#closeHandle();
      throw error;
    }
  }
  async #closeHandle(): Promise<void> {
    const current = this.#handle;
    if (!current) return;
    try {
      await (await current.catch(() => undefined))?.close();
    } finally {
      if (this.#handle === current) this.#handle = undefined;
    }
  }
}
